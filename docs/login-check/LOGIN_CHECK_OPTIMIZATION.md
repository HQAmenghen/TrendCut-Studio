# 登录检测逻辑优化

## 问题描述

已登录的账号检测失败，浏览器窗口不关闭。

## 问题分析

### 1. 判断逻辑过于严格
之前要求必须同时满足 `dashboard_url and dashboard_ui` 才认为已登录，但实际情况是：
- 页面可能还在加载中，UI 元素还没渲染完成
- 某些 UI 选择器可能不匹配当前页面版本
- 导致已登录的账号被判断为 "unknown" 状态

### 2. unknown 状态处理不当
当状态为 "unknown" 时，代码会继续执行到 "需要登录" 的逻辑：
- 尝试捕获二维码（但实际上没有二维码）
- 进入等待扫码的循环（180 秒超时）
- 浏览器窗口一直不关闭

## 解决方案

### 1. 优化判断逻辑

采用更灵活的判断策略：

```python
# 判断优先级：
# 1. 如果检测到登录页面（URL 或 UI），标记为需要登录
# 2. 如果 URL 是 dashboard 且 UI 也匹配，确定已登录
# 3. 如果 URL 是 dashboard 但 UI 不匹配（可能页面还在加载），也认为已登录

if login_url or login_ui:
    has_login = True

if dashboard_url and dashboard_ui:
    has_dashboard = True
# 关键改进：如果 URL 是 dashboard 但没有检测到登录 UI，也认为是 dashboard
elif dashboard_url and not login_ui:
    has_dashboard = True
```

**逻辑说明：**
- 如果 URL 已经是 dashboard，且没有检测到登录 UI，说明很可能已经登录
- 只有当明确检测到登录 UI 时，才认为需要登录
- 这样可以避免因为 UI 选择器不匹配而误判

### 2. 增加 unknown 状态的重试机制

```python
if state == "unknown":
    ulog("State is unknown, waiting a bit more...")
    time.sleep(3)  # 再等待 3 秒
    state, details = classify_browser_state(browser)
    ulog(f"Re-check browser state={state}")
    if state == "dashboard":
        ulog("Confirmed logged in after re-check!")
        print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
        time.sleep(2)
        browser.close()
        return
```

**重试机制说明：**
- 如果第一次检测状态为 "unknown"，再等待 3 秒
- 重新检测一次状态
- 如果确认是 "dashboard"，关闭浏览器并返回
- 避免因为页面加载慢而误判

### 3. 增加更多 UI 选择器

```python
def page_has_dashboard_ui(page) -> bool:
    selectors = [
        ".weui-desktop-layout__main__bd",
        ".weui-desktop-layout",
        ".post-create-container",
        "input[type='file']",
        ".finder-mention-topic",
        # 新增更通用的选择器
        ".weui-desktop-layout__hd",  # 顶部导航栏
        ".weui-desktop-layout__sidebar",  # 侧边栏
        "[class*='desktop-layout']",  # 任何包含 desktop-layout 的类
        "button[class*='post']",  # 发布相关按钮
        ".weui-desktop-global-navigation",  # 全局导航
    ]
```

**选择器优化说明：**
- 增加更多通用的选择器
- 使用属性选择器 `[class*='xxx']` 匹配包含特定字符串的类名
- 提高 UI 元素的识别率

## 判断流程

### 完整的判断流程

```
1. 访问 https://channels.weixin.qq.com/platform
   ↓
2. 等待 5 秒（3 秒 + 2 秒）
   ↓
3. 检测浏览器状态
   ├─ dashboard → 已登录 → 关闭浏览器 ✓
   ├─ login → 需要登录 → 显示二维码 → 等待扫码
   └─ unknown → 再等待 3 秒 → 重新检测
       ├─ dashboard → 已登录 → 关闭浏览器 ✓
       └─ 其他 → 需要登录 → 显示二维码 → 等待扫码
```

### 状态判断逻辑

```
对于每个页面：
1. 检查 URL 和 UI 元素
2. 判断优先级：
   - 如果有登录 UI → 标记为 login
   - 如果 URL 是 dashboard 且 UI 匹配 → 标记为 dashboard
   - 如果 URL 是 dashboard 且没有登录 UI → 也标记为 dashboard
3. 返回最终状态：
   - 有 dashboard → 返回 "dashboard"
   - 有 login → 返回 "login"
   - 都没有 → 返回 "unknown"
```

## 优势

### 1. 更准确的判断
- 减少误判：已登录的账号不会被判断为需要登录
- 更灵活：即使 UI 选择器不匹配，也能通过 URL 判断
- 更可靠：增加了重试机制，避免因页面加载慢而误判

### 2. 更好的用户体验
- 浏览器会正确关闭：已登录的账号检测完成后立即关闭
- 减少等待时间：不会进入 180 秒的扫码等待
- 更清晰的反馈：日志中会显示详细的判断过程

### 3. 更强的兼容性
- 增加了更多 UI 选择器
- 使用通配符匹配，适应页面结构变化
- 即使微信更新页面，也能正确识别

## 测试建议

### 测试场景 1：已登录账号
1. 使用已登录的账号
2. 点击"检测登录"
3. 预期结果：
   - 浏览器打开
   - 等待约 5-8 秒
   - 显示"已登录"
   - 浏览器自动关闭

### 测试场景 2：未登录账号
1. 使用未登录的账号
2. 点击"检测登录"
3. 预期结果：
   - 浏览器打开
   - 显示登录二维码
   - 状态显示"需要登录"
   - 等待扫码或超时

### 测试场景 3：网络慢的情况
1. 模拟网络延迟
2. 点击"检测登录"
3. 预期结果：
   - 第一次检测可能为 "unknown"
   - 等待 3 秒后重新检测
   - 最终能正确判断状态

## 调试技巧

### 查看详细日志
检测过程中会输出详细的日志：
```
WECHAT_LOGIN_CHECK|Initial browser state=unknown details=[...]
WECHAT_LOGIN_CHECK|State is unknown, waiting a bit more...
WECHAT_LOGIN_CHECK|Re-check browser state=dashboard details=[...]
WECHAT_LOGIN_CHECK|Confirmed logged in after re-check!
```

### 日志字段说明
```json
{
  "index": 0,
  "url": "https://channels.weixin.qq.com/platform/...",
  "login_url": false,
  "dashboard_url": true,
  "login_ui": false,
  "dashboard_ui": true
}
```

- `login_url`: URL 是否包含 "/login"
- `dashboard_url`: URL 是否是 dashboard
- `login_ui`: 是否检测到登录页面的 UI 元素
- `dashboard_ui`: 是否检测到 dashboard 的 UI 元素

### 如果仍然检测失败

1. **检查日志中的 details 字段**
   - 查看 URL 是否正确
   - 查看哪些 UI 检测失败了

2. **增加等待时间**
   - 如果网络很慢，可以增加 `time.sleep` 的值
   - 第一次等待：`time.sleep(3)` → `time.sleep(5)`
   - 重试等待：`time.sleep(3)` → `time.sleep(5)`

3. **添加更多 UI 选择器**
   - 打开浏览器开发者工具
   - 查看实际页面的 HTML 结构
   - 添加更准确的选择器到 `page_has_dashboard_ui`

4. **调整判断逻辑**
   - 如果 URL 判断已经足够准确，可以完全依赖 URL
   - 修改为：`if dashboard_url: has_dashboard = True`

## 注意事项

1. **不要过度依赖 UI 选择器**：微信可能会更新页面结构，导致选择器失效
2. **URL 是更可靠的判断依据**：URL 变化的可能性较小
3. **保留详细日志**：方便排查问题
4. **定期更新选择器**：如果微信更新了页面，及时更新选择器列表
