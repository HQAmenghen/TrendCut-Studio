# 登录检测问题诊断指南

## 当前问题

已登录的账号被检测为未登录，浏览器不关闭。

## 诊断步骤

### 第一步：查看详细日志

运行检测后，查看控制台输出的详细日志：

```
WECHAT_LOGIN_CHECK|Initial browser state=xxx
WECHAT_LOGIN_CHECK|  Page 0: URL=https://...
WECHAT_LOGIN_CHECK|    login_url=false, login_ui=false
WECHAT_LOGIN_CHECK|    dashboard_url=true, dashboard_ui=false
```

**关键信息：**
- `login_url`: URL 是否包含 `/login` 或 `login.html`
- `login_ui`: 是否检测到登录页面的 UI 元素
- `dashboard_url`: URL 是否是 dashboard（不包含 `/login`）
- `dashboard_ui`: 是否检测到 dashboard 的 UI 元素

### 第二步：分析判断结果

根据日志中的四个布尔值，判断问题所在：

#### 情况 1：已登录但被误判为未登录
```
login_url=false, login_ui=false
dashboard_url=true, dashboard_ui=false
结果: unknown 或 login（错误）
```

**原因：** dashboard_ui 没有匹配到
**解决：** 需要检查 UI 选择器是否正确

#### 情况 2：未登录但被误判为已登录
```
login_url=false, login_ui=false
dashboard_url=true, dashboard_ui=false
结果: dashboard（错误）
```

**原因：** 页面正在重定向，URL 还是 dashboard
**解决：** 需要等待重定向完成

#### 情况 3：正确识别已登录
```
login_url=false, login_ui=false
dashboard_url=true, dashboard_ui=true
结果: dashboard（正确）
```

#### 情况 4：正确识别未登录
```
login_url=true, login_ui=true
dashboard_url=false, dashboard_ui=false
结果: login（正确）
```

### 第三步：检查 UI 选择器

如果 `dashboard_ui=false` 但实际已登录，说明 UI 选择器不匹配。

**当前的 dashboard UI 选择器：**
```python
selectors = [
    ".weui-desktop-layout__main__bd",
    ".weui-desktop-layout",
    ".post-create-container",
    "input[type='file']",
    ".finder-mention-topic",
    ".weui-desktop-layout__hd",
    ".weui-desktop-layout__sidebar",
    "[class*='desktop-layout']",
    "button[class*='post']",
    ".weui-desktop-global-navigation",
]
```

**检查方法：**
1. 打开浏览器开发者工具（F12）
2. 在已登录的页面上，检查这些选择器是否存在
3. 在控制台运行：
   ```javascript
   document.querySelectorAll('.weui-desktop-layout').length
   document.querySelectorAll('[class*="desktop-layout"]').length
   ```
4. 如果返回 0，说明选择器不匹配

### 第四步：临时解决方案

如果 UI 选择器确实不匹配，可以临时使用更宽松的判断：

**方案 A：完全依赖 URL**
```python
if dashboard_url:
    has_dashboard = True
```

**方案 B：增加等待时间**
```python
# 增加等待时间，让 UI 有更多时间加载
time.sleep(5)  # 从 2 秒增加到 5 秒
```

**方案 C：添加更通用的选择器**
```python
# 添加更通用的选择器
"[class*='weui']",  # 任何包含 weui 的类
"nav",  # 导航栏
"header",  # 页头
```

## 当前的判断逻辑

```python
if login_url:
    # URL 明确是登录页面
    has_login = True
elif login_ui:
    # 检测到登录 UI
    has_login = True
elif dashboard_url:
    # URL 是 dashboard
    if dashboard_ui:
        # 有 dashboard UI，确定已登录
        has_dashboard = True
    elif not login_ui:
        # 没有 dashboard UI，但也没有 login UI
        # 可能是页面还在加载，暂时认为已登录
        has_dashboard = True
```

**逻辑说明：**
1. 如果 URL 是登录页面 → 需要登录
2. 如果检测到登录 UI → 需要登录
3. 如果 URL 是 dashboard：
   - 有 dashboard UI → 已登录
   - 没有 dashboard UI 但也没有 login UI → 已登录（宽松判断）
   - 有 login UI → 需要登录

## 快速修复建议

### 建议 1：使用更可靠的 URL 判断

如果 UI 选择器不稳定，可以主要依赖 URL：

```python
# 在 classify_browser_state 函数中
if login_url:
    has_login = True
elif dashboard_url and not login_ui:
    # URL 是 dashboard 且没有登录 UI，认为已登录
    has_dashboard = True
```

### 建议 2：增加特定的 dashboard 选择器

根据实际页面添加更准确的选择器：

```python
# 打开浏览器开发者工具，找到 dashboard 页面特有的元素
# 例如：
".specific-dashboard-class",  # 替换为实际的类名
"#dashboard-container",  # 替换为实际的 ID
```

### 建议 3：使用页面标题判断

```python
def page_has_dashboard_ui(page) -> bool:
    try:
        # 检查页面标题
        title = page.title()
        if "视频号" in title and "登录" not in title:
            return True

        # 原有的选择器检查
        for selector in selectors:
            if page.locator(selector).count() > 0:
                return True
    except Exception as e:
        ulog(f"Dashboard UI check error: {e}")
    return False
```

## 测试命令

### 手动测试 Python 脚本

```bash
cd python/publish
python wechat_check_login.py \
  --user-data-dir "../../data/wechat_profiles/account_xxx" \
  --account-id "account_xxx"
```

查看输出的详细日志，特别是：
- `Initial browser state=xxx`
- `login_url`, `login_ui`, `dashboard_url`, `dashboard_ui` 的值

### 测试 UI 选择器

在浏览器控制台运行：

```javascript
// 测试所有选择器
const selectors = [
    ".weui-desktop-layout__main__bd",
    ".weui-desktop-layout",
    ".post-create-container",
    "input[type='file']",
    ".finder-mention-topic",
    ".weui-desktop-layout__hd",
    ".weui-desktop-layout__sidebar",
    "[class*='desktop-layout']",
    "button[class*='post']",
    ".weui-desktop-global-navigation",
];

selectors.forEach(sel => {
    const count = document.querySelectorAll(sel).length;
    console.log(`${sel}: ${count}`);
});
```

## 需要提供的信息

为了更好地诊断问题，请提供：

1. **日志输出**：
   ```
   WECHAT_LOGIN_CHECK|Initial browser state=xxx
   WECHAT_LOGIN_CHECK|  Page 0: URL=...
   WECHAT_LOGIN_CHECK|    login_url=?, login_ui=?
   WECHAT_LOGIN_CHECK|    dashboard_url=?, dashboard_ui=?
   ```

2. **实际的 URL**：
   - 已登录时的 URL 是什么？
   - 未登录时的 URL 是什么？

3. **页面标题**：
   - 已登录时的页面标题是什么？
   - 未登录时的页面标题是什么？

4. **UI 选择器测试结果**：
   - 哪些选择器返回 > 0？
   - 哪些选择器返回 0？

有了这些信息，我可以提供更精确的修复方案。
