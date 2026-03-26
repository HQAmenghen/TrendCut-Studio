const cron = require('node-cron');

function startScheduler({ publishStore, wechatRpaService, xaiService, verticalQueueService, generatePublishDescription, publishAssetsService }) {
  console.log('[Scheduler] 初始化定时调度引擎 - node-cron');
  
  const autoPilotJobs = new Map(); // jobId -> rank (0, 1, 2...)
  const fetchState = { lastFetchedDate: '' };
  
  // 每分钟统一事件轮询
  cron.schedule('* * * * *', async () => {
    
    // ---- 动态时间抓取数据引擎 ----
    const config = publishStore?.readPublishConfig() || {};
    const fetchTime = config?.global?.autoPilotFetchTime || '07:30';
    const [targetH, targetM] = fetchTime.split(':');
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (now.getHours() === parseInt(targetH, 10) && now.getMinutes() === parseInt(targetM, 10)) {
      if (fetchState.lastFetchedDate !== todayStr) {
        fetchState.lastFetchedDate = todayStr;
        console.log(`[Scheduler -> xAI] 到达设定的定时数据更新时间 (${fetchTime})`);
        
        try {
          if (xaiService && typeof xaiService.run === 'function') {
            const dummyRes = { json: ()=>{}, send: ()=>{}, status: function(){ return this; }, headersSent: false };

            if (config?.global?.autoPilotEnabled) {
              console.log(`[AutoPilot] 检测到托管模式开启，启动无人值守发片流水线`);
              await xaiService.run('autopilot-cron', dummyRes);
              
              const result = xaiService.ensureTranslatedResult();
              const count = config?.global?.autoPilotCount || 1;
              const topItems = (result?.items || []).slice(0, count);
              if (topItems.length === 0) {
                console.log(`[AutoPilot] 未找到可用数据，结束流水线`);
              } else {
                for (let i = 0; i < topItems.length; i++) {
                  const topItem = topItems[i];
                  if (verticalQueueService && typeof verticalQueueService.enqueue === 'function') {
                    const vjob = verticalQueueService.enqueue({
                      sourceType: 'xai_top10',
                      title: topItem.title,
                      summary: topItem.author_summary_zh || topItem.author_summary || topItem.summary,
                      videoUrl: topItem.video_url || topItem.videoUrl,
                      author: topItem.author,
                      postId: topItem.post_id || topItem.postId,
                      postUrl: topItem.post_url || topItem.postUrl,
                      renderOptions: {}
                    });
                    autoPilotJobs.set(vjob.id, i);
                    console.log(`[AutoPilot] 已将 Top ${i + 1} 推文送入渲染队列: ${vjob.id}`);
                  }
                }
              }
            } else {
              xaiService.run('system-cron', dummyRes);
            }
          }
        } catch (err) {
          console.error(`[Scheduler -> xAI] 定时拉取失败:`, err.message);
        }
      }
    }

    // ---- AutoPilot 渲染完毕监控器 ----
    if (verticalQueueService && publishStore && generatePublishDescription && publishAssetsService) {
      for (const [vjobId, rank] of Array.from(autoPilotJobs.entries())) {
         const vjob = verticalQueueService.getJob(vjobId);
         if (!vjob) { autoPilotJobs.delete(vjobId); continue; }
         if (['cancelled', 'failed'].includes(vjob.status)) { autoPilotJobs.delete(vjobId); continue; }
         
         if (vjob.status === 'completed') {
           autoPilotJobs.delete(vjobId);
           console.log(`[AutoPilot] 视频渲染完毕，正在自动创建发布任务: ${vjobId}`);
           
           publishAssetsService.resetPublishAssetsCache();
           const assets = publishAssetsService.collectPublishAssets();
           const asset = assets.find(a => String(a.url).includes(vjobId));
           
           if (!asset) {
             console.log(`[AutoPilot] 无法在 Asset 库中找到渲染成品: ${vjobId}`);
             continue;
           }

           const desc = generatePublishDescription(
             asset.metadata?.sourceSummary || asset.metadata?.suggestedDescription || '',
             { title: asset.compactLabel || asset.label, includeTags: false }
           );
           
           const publishData = { 
             title: asset.compactLabel || asset.label, 
             description: desc || asset.metadata?.suggestedDescription || '', 
             tagStrategy: 'system', 
             tags: ['热点速递', '每日快讯'], 
             coverUrl: '' 
           };
           
           const pcfg = config['wechatChannels'];
           const targetAccountIds = config?.global?.autoPilotAccountIds || [];
           const assignedAccountId = targetAccountIds[rank];
           
           let account = null;
           if (assignedAccountId && Array.isArray(pcfg?.accounts)) {
             account = pcfg.accounts.find(a => a.id === assignedAccountId);
           }
           if (!account && Array.isArray(pcfg?.accounts) && pcfg.accounts.length > 0) {
             account = pcfg.accounts[0];
           }

           const dateStr = new Date().toISOString().split('T')[0];
           const targetTimes = config?.global?.autoPilotTimes || [];
           const targetTime = targetTimes[rank] || config?.global?.autoPilotTime || '08:00';
           
           const localTarget = new Date(`${dateStr}T${targetTime}:00`);
           const isoScheduledTime = localTarget.toISOString();
           
           const pJob = {
             id: publishStore.makeJobId ? publishStore.makeJobId() : `job_${Date.now()}`,
             createdAt: new Date().toISOString(),
             updatedAt: new Date().toISOString(),
             archived: false,
             archivedAt: null,
             status: 'scheduled_wait',
             scheduledTime: isoScheduledTime,
             asset,
             publishData,
             selectedPlatforms: ['wechatChannels'],
             platformSelections: {
               wechatChannels: account ? { accountId: account.id, accountLabel: account.displayName || account.finderUserName } : {}
             },
             platformTasks: [],
             platformErrors: []
           };

           const payload = publishStore.readPublishJobs();
           payload.jobs.unshift(pJob);
           publishStore.writePublishJobs(payload);
           publishStore.reconcileAndPersistPublishJobs(config);
           console.log(`[AutoPilot] 已成功创建微信发布任务 [${pJob.id}]，预定发布时间：${isoScheduledTime}`);
         }
      }
    }

    // ---- 微信定时发布到期接管执行器 ----
    if (!publishStore || typeof publishStore.getDueScheduledJobs !== 'function') {
      return;
    }
    
    let dueJobs = [];
    try {
      dueJobs = publishStore.getDueScheduledJobs(Date.now());
    } catch (err) {
      console.error(`[Scheduler -> 微信发布] 查询到期任务失败:`, err.message);
      return;
    }

    for (const job of dueJobs) {
      console.log(`[Scheduler -> 微信发布] 定时任务到期，开始启动微信自动发布: [${job.publishData?.title || '未命名'}] (${job.id})`);
      try {
        publishStore.updatePublishJob(job.id, (current) => {
          current.status = 'ready';
          if (Array.isArray(current.platformTasks)) {
            for (const task of current.platformTasks) {
              if (task.platform === 'wechatChannels') {
                task.status = 'ready';
              }
            }
          }
          return current;
        });

        if (wechatRpaService && typeof wechatRpaService.startWechatRpa === 'function') {
           wechatRpaService.startWechatRpa(job.id, 'publish');
        }
      } catch (err) {
        console.error(`[Scheduler -> 微信发布] 触发任务 [${job.id}] 失败:`, err.message);
      }
    }
  });
}

module.exports = {
  startScheduler
};
