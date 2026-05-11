---
status: investigating
trigger: "检查我的定时发布任务，具体创建的任务是怎么样的？怎么会多了一些，不达标的规则批量产物。而且今早应该只有3个任务的，出现了6个"
created: "2026-05-09T09:07:40+08:00"
updated: "2026-05-09T09:07:40+08:00"
---

# Debug Session: scheduled-publish-extra-tasks

## Symptoms

- Expected behavior: 2026-05-09 morning should have created only 3 scheduled publish tasks.
- Actual behavior: 6 publish tasks appeared, including some batch products that do not meet the configured rules.
- Error messages: None reported.
- Timeline: Observed on the morning of 2026-05-09 Asia/Shanghai time.
- Reproduction: Inspect scheduled publish task creation and compare generated publish jobs against configured automation rules.

## Current Focus

- hypothesis: Scheduled publish automation is creating duplicate or cross-mode jobs, or filtering rules are not being applied consistently to batch-created products.
- test: Inspect scheduler configuration, publish job database rows created on 2026-05-09 morning, and automation plan generation code.
- expecting: Evidence should identify whether duplicate runs, multiple matching plans, recovery replay, or rule-filter bypass caused 6 tasks instead of 3.
- next_action: gather initial evidence
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-09T09:17:28+08:00
  source: data/logs/scheduler.log and data/logs/server.log
  finding: The 2026-05-09 morning scheduler run started at 07:02:00 Asia/Shanghai (`2026-05-08T23:02:00Z`) with AutoPilot enabled, `sourceMode:"refresh_ranking"`, and then enqueued two separate pipeline modes. At 07:06:51 local it enqueued three direct `vertical` jobs from crypto source ranks 7, 8, and 9; at the same minute it enqueued three `avatar` pending jobs from crypto source ranks 1, 2, and 3.
- timestamp: 2026-05-09T09:17:28+08:00
  source: python/publish/platform_config.json
  finding: The active publish config has `global.autoPilotPipelineModes:["vertical","avatar"]`. The `vertical` mode schedule maps three accounts to publish times 18:15, 18:08, and 18:20 with `sourceRanks:["7","8","9",...]`; the `avatar` mode schedule maps the same three accounts to 07:33, 08:30, and 08:00 with `sourceRanks:["1","2","3",...]`.
- timestamp: 2026-05-09T09:17:28+08:00
  source: server/services/system/scheduler.js:142, server/services/system/scheduler.js:327, server/services/system/scheduler.js:332, server/services/system/scheduler.js:443, server/services/system/scheduler.js:524, server/services/system/scheduler.js:1009
  finding: The scheduler treats `autoPilotPipelineModes` as additive. `getAutoPilotPipelineModes()` returns every configured mode, `enqueueAutoPilotTopItems()` iterates each mode, `enqueueAutoPilotTopItemsForMode()` enqueues each mode's slots independently, and completed queue jobs are each written as publish jobs. There is no code path that makes `avatar` replace/suppress `vertical` when both modes are enabled.
- timestamp: 2026-05-09T09:17:28+08:00
  source: data/tasks.db
  finding: Six vertical queue tasks were created in the morning window: three direct `xai_top10` tasks (`1778281611854_pc0azpt`, sourceRank 7; `1778281611869_yy1pjn2`, sourceRank 8; `1778281611881_kk29qtl`, sourceRank 9) and three `material_driven_avatar` bridge tasks (`1778283720056_krvj5oo`, sourceRank 1; `1778285640063_xyyk7lq`, sourceRank 2; `1778287980040_5ypsbdk`, sourceRank 3).
- timestamp: 2026-05-09T09:17:28+08:00
  source: data/logs/scheduler.log and data/logs/server.log
  finding: The six scheduler-created publish jobs were: `1778281899256_8a653b4a` (vertical rank 2/sourceRank 8, Web3plus, scheduled 18:08, title `这条消息可能正在改变支付格局`), `1778282005075_7ba7a61d` (vertical rank 3/sourceRank 9, RWAplus, scheduled 18:20, title `这条消息可能正在改变支付格局`), `1778282533796_b6e2657d` (vertical rank 1/sourceRank 7, Web4plus, scheduled 18:15, title `汤姆李放话 比特币将破25万美元？`), `1778284267142_499b84fa` (avatar rank 1/sourceRank 1, Web4plus, scheduled 07:33 catch-up, title `稀缺资产主线 标普年底要冲7700？`), `1778286187632_ecadd5f4` (avatar rank 2/sourceRank 2, Web3plus, scheduled 08:30, title `陶锡赌注69% 比特币身份要合法了？`), and `1778288710227_317b429f` (avatar rank 3/sourceRank 3, RWAplus, scheduled 08:00 catch-up, title `维克斯喊20万 历史规律还能信吗？`).
- timestamp: 2026-05-09T09:17:28+08:00
  source: python/publish/wechat_channels_tasks
  finding: Three WeChat RPA payload files exist for the avatar publish jobs that became due in the morning (`1778284267142_499b84fa_wechatChannels.json`, `1778286187632_ecadd5f4_wechatChannels.json`, and `1778288710227_317b429f_wechatChannels.json`). The vertical jobs were scheduled for 18:08/18:15/18:20 local and therefore were created but not due in the morning.
- timestamp: 2026-05-09T09:17:28+08:00
  source: python/publish/publish_jobs.db and python/publish/publish_jobs.db-wal
  finding: Binary inspection of the publish DB/WAL contains the six scheduler job ids above. A later non-scheduled job `1778288902089_9c92e5c4` appears with `status:"ready"` and `scheduledAt:null`; it is not part of the scheduler-created six and was not logged as an AutoPilot scheduled publish task.

## Eliminated

- hypothesis: Duplicate cron execution or scheduler replay created the extra three publish jobs.
  evidence: The logs show one 07:02 local AutoPilot fetch for 2026-05-09 and one intentional pass over two configured modes. The six jobs have different pipeline modes/source ranks rather than duplicated queue/job ids.
- hypothesis: Publish job persistence duplicated rows during SQLite reconciliation.
  evidence: The six job ids map one-to-one to six distinct queue jobs and six distinct source videos or avatar-derived bridge videos; the excess count exists before persistence, at scheduler enqueue time.
- hypothesis: Blank schedule slots directly created extra publish jobs.
  evidence: The scheduler logged ranks 4-10 as skipped for both modes because the account mapping was empty. Only the first three account slots in each active mode produced queue and publish jobs.
- hypothesis: WeChat RPA created the extra scheduled publish tasks.
  evidence: RPA payload files exist only for due jobs after publish job creation. The direct vertical extra jobs were scheduled for 18:08/18:15/18:20 and were already created before any RPA payload for those jobs.

## Resolution

- root_cause: The six tasks were caused by configuration plus scheduler semantics, not by a duplicate cron run. `autoPilotPipelineModes` was set to both `vertical` and `avatar`, and the scheduler treats those modes as additive. Because each mode had three mapped account slots, the 2026-05-09 morning AutoPilot run intentionally produced 3 direct XAI batch vertical publish jobs plus 3 avatar-derived publish jobs. The "extra" batch products are the active `vertical` mode outputs using source ranks 7/8/9.
- fix: Not applied in this root-cause-only investigation. To make the morning run create only the expected three digital-human tasks, remove `vertical` from `global.autoPilotPipelineModes` or change the scheduler/config UI so `avatar` is exclusive for this automation profile. If both modes should be allowed in the UI, add a clearer warning/summary that the total planned job count is `sum(active mode account slots)`, not `autoPilotCount`.
- verification: Read-only investigation only. Correlated scheduler/server logs, `data/tasks.db`, `python/publish/platform_config.json`, WeChat RPA payload files, and publish DB/WAL contents for the 2026-05-09 Asia/Shanghai morning window.
- files_changed: `.planning/debug/scheduled-publish-extra-tasks.md`
