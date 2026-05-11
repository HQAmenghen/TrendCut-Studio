"""Helpers for preserving subtitle terms during translation."""

from __future__ import annotations

import re


COMMON_CAPITALIZED_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "do",
    "for",
    "from",
    "he",
    "her",
    "his",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "no",
    "of",
    "on",
    "or",
    "our",
    "she",
    "so",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "to",
    "us",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}

ASCII_LEFT_BOUNDARY = r"(?<![A-Za-z0-9_])"
ASCII_RIGHT_BOUNDARY = r"(?![A-Za-z0-9_])"
MAX_SINGLE_CAPITALIZED_TERM_LENGTH = 18
JOINED_ENGLISH_SENTENCE_MARKERS = (
    "andsoi",
    "andithink",
    "andi",
    "ithink",
    "when",
    "what",
    "where",
    "why",
    "how",
)

SINGLE_CAPITALIZED_PATTERN = re.compile(
    rf"{ASCII_LEFT_BOUNDARY}[A-Z][a-z]{{3,}}{ASCII_RIGHT_BOUNDARY}"
)

TERM_PATTERNS = [
    re.compile(rf"{ASCII_LEFT_BOUNDARY}(?:[A-Z][A-Za-z0-9]*)(?:\s+[A-Z0-9][A-Za-z0-9]*)+{ASCII_RIGHT_BOUNDARY}"),
    re.compile(rf"\$[A-Z0-9][A-Z0-9._/-]*{ASCII_RIGHT_BOUNDARY}|{ASCII_LEFT_BOUNDARY}[A-Z]{{2,}}(?:\d+[A-Z0-9]*)?(?:[./-][A-Z0-9]+)*{ASCII_RIGHT_BOUNDARY}"),
    re.compile(rf"{ASCII_LEFT_BOUNDARY}[A-Za-z]*\d+[A-Za-z\d._/-]*{ASCII_RIGHT_BOUNDARY}"),
    re.compile(r"(?<!\w)-?\d[\d,]*(?:\.\d+)?%?"),
    re.compile(rf"{ASCII_LEFT_BOUNDARY}[A-Za-z][A-Za-z0-9._/-]*[A-Z][A-Za-z0-9._/-]*{ASCII_RIGHT_BOUNDARY}"),
    SINGLE_CAPITALIZED_PATTERN,
]

PERSON_NAME_PATTERN = re.compile(
    rf"{ASCII_LEFT_BOUNDARY}[A-Z][a-z]{{2,}}\s+[A-Z][a-z]{{1,}}{ASCII_RIGHT_BOUNDARY}"
)

REFERENCE_HOMOPHONE_CORRECTIONS = {
    "美股": ("每股",),
}

TRADITIONAL_PHRASE_MAP = {
    "台灣": "台湾",
    "臺灣": "台湾",
    "週期": "周期",
    "週末": "周末",
    "週一": "周一",
    "週二": "周二",
    "週三": "周三",
    "週四": "周四",
    "週五": "周五",
    "週六": "周六",
    "週日": "周日",
    "隨著": "随着",
    "想像": "想象",
    "佈局": "布局",
    "釐清": "厘清",
    "數據": "数据",
    "資訊": "信息",
    "伺服器": "服务器",
    "軟體": "软件",
    "硬體": "硬件",
    "網際網路": "互联网",
}

TRADITIONAL_CHAR_MAP = str.maketrans({
    "萬": "万",
    "與": "与",
    "專": "专",
    "業": "业",
    "東": "东",
    "絲": "丝",
    "兩": "两",
    "嚴": "严",
    "喪": "丧",
    "個": "个",
    "豐": "丰",
    "臨": "临",
    "為": "为",
    "麗": "丽",
    "舉": "举",
    "麼": "么",
    "義": "义",
    "烏": "乌",
    "樂": "乐",
    "喬": "乔",
    "習": "习",
    "鄉": "乡",
    "書": "书",
    "買": "买",
    "亂": "乱",
    "爭": "争",
    "於": "于",
    "虧": "亏",
    "雲": "云",
    "亞": "亚",
    "產": "产",
    "畝": "亩",
    "親": "亲",
    "億": "亿",
    "僅": "仅",
    "從": "从",
    "倉": "仓",
    "儀": "仪",
    "們": "们",
    "價": "价",
    "眾": "众",
    "優": "优",
    "會": "会",
    "傘": "伞",
    "偉": "伟",
    "傳": "传",
    "傷": "伤",
    "倫": "伦",
    "債": "债",
    "傾": "倾",
    "僂": "偻",
    "僑": "侨",
    "僱": "雇",
    "價": "价",
    "儲": "储",
    "兒": "儿",
    "兌": "兑",
    "內": "内",
    "兩": "两",
    "冊": "册",
    "凈": "净",
    "凍": "冻",
    "劃": "划",
    "別": "别",
    "刪": "删",
    "剛": "刚",
    "創": "创",
    "劑": "剂",
    "劍": "剑",
    "劇": "剧",
    "勁": "劲",
    "動": "动",
    "務": "务",
    "勛": "勋",
    "勝": "胜",
    "勞": "劳",
    "勢": "势",
    "勳": "勋",
    "匯": "汇",
    "區": "区",
    "協": "协",
    "單": "单",
    "賣": "卖",
    "盧": "卢",
    "衛": "卫",
    "卻": "却",
    "廠": "厂",
    "廳": "厅",
    "歷": "历",
    "壓": "压",
    "厭": "厌",
    "厲": "厉",
    "參": "参",
    "雙": "双",
    "發": "发",
    "變": "变",
    "敘": "叙",
    "葉": "叶",
    "號": "号",
    "嘆": "叹",
    "後": "后",
    "嚇": "吓",
    "呂": "吕",
    "嗎": "吗",
    "啟": "启",
    "吳": "吴",
    "員": "员",
    "問": "问",
    "啞": "哑",
    "啟": "启",
    "喚": "唤",
    "喪": "丧",
    "喬": "乔",
    "單": "单",
    "嗚": "呜",
    "嗩": "唢",
    "嘗": "尝",
    "嘩": "哗",
    "嘮": "唠",
    "嘯": "啸",
    "嘰": "叽",
    "噴": "喷",
    "噸": "吨",
    "嚮": "向",
    "嚨": "咙",
    "嚮": "向",
    "嚴": "严",
    "囑": "嘱",
    "囪": "囱",
    "圍": "围",
    "園": "园",
    "國": "国",
    "圖": "图",
    "圓": "圆",
    "聖": "圣",
    "場": "场",
    "壞": "坏",
    "塊": "块",
    "堅": "坚",
    "壇": "坛",
    "壩": "坝",
    "壓": "压",
    "壘": "垒",
    "壟": "垄",
    "壯": "壮",
    "聲": "声",
    "壺": "壶",
    "壽": "寿",
    "夢": "梦",
    "夥": "伙",
    "夾": "夹",
    "奪": "夺",
    "奮": "奋",
    "奧": "奥",
    "婦": "妇",
    "媽": "妈",
    "嫻": "娴",
    "嬌": "娇",
    "嬰": "婴",
    "孫": "孙",
    "學": "学",
    "寧": "宁",
    "寶": "宝",
    "實": "实",
    "審": "审",
    "寫": "写",
    "寬": "宽",
    "寵": "宠",
    "將": "将",
    "專": "专",
    "尋": "寻",
    "對": "对",
    "導": "导",
    "小": "小",
    "屆": "届",
    "屬": "属",
    "岡": "冈",
    "島": "岛",
    "峽": "峡",
    "崗": "岗",
    "嶺": "岭",
    "嶽": "岳",
    "幣": "币",
    "帥": "帅",
    "師": "师",
    "帳": "账",
    "帶": "带",
    "幀": "帧",
    "幫": "帮",
    "幹": "干",
    "幾": "几",
    "庫": "库",
    "廁": "厕",
    "廂": "厢",
    "廈": "厦",
    "廚": "厨",
    "廟": "庙",
    "廢": "废",
    "廣": "广",
    "廠": "厂",
    "廳": "厅",
    "彈": "弹",
    "彌": "弥",
    "彎": "弯",
    "張": "张",
    "強": "强",
    "彙": "汇",
    "彞": "彝",
    "當": "当",
    "錄": "录",
    "彥": "彦",
    "徑": "径",
    "從": "从",
    "復": "复",
    "徵": "征",
    "德": "德",
    "恆": "恒",
    "戀": "恋",
    "恥": "耻",
    "悅": "悦",
    "懸": "悬",
    "慘": "惨",
    "慶": "庆",
    "憂": "忧",
    "懇": "恳",
    "應": "应",
    "懶": "懒",
    "懷": "怀",
    "懲": "惩",
    "懼": "惧",
    "戰": "战",
    "戲": "戏",
    "戶": "户",
    "拋": "抛",
    "挾": "挟",
    "捨": "舍",
    "掃": "扫",
    "掄": "抡",
    "掙": "挣",
    "掛": "挂",
    "採": "采",
    "揀": "拣",
    "揚": "扬",
    "換": "换",
    "揮": "挥",
    "損": "损",
    "搖": "摇",
    "搶": "抢",
    "擔": "担",
    "據": "据",
    "擠": "挤",
    "擴": "扩",
    "擺": "摆",
    "擾": "扰",
    "攜": "携",
    "攝": "摄",
    "攤": "摊",
    "攪": "搅",
    "敗": "败",
    "敘": "叙",
    "敵": "敌",
    "數": "数",
    "斂": "敛",
    "斃": "毙",
    "斬": "斩",
    "斷": "断",
    "於": "于",
    "時": "时",
    "晉": "晋",
    "晝": "昼",
    "暈": "晕",
    "暫": "暂",
    "曆": "历",
    "書": "书",
    "會": "会",
    "朧": "胧",
    "東": "东",
    "極": "极",
    "構": "构",
    "槍": "枪",
    "樣": "样",
    "樁": "桩",
    "樂": "乐",
    "樓": "楼",
    "標": "标",
    "樞": "枢",
    "樹": "树",
    "橋": "桥",
    "機": "机",
    "橫": "横",
    "檔": "档",
    "檢": "检",
    "櫃": "柜",
    "權": "权",
    "欄": "栏",
    "歐": "欧",
    "歡": "欢",
    "歲": "岁",
    "殘": "残",
    "殼": "壳",
    "毀": "毁",
    "氣": "气",
    "氫": "氢",
    "決": "决",
    "沒": "没",
    "沖": "冲",
    "況": "况",
    "洶": "汹",
    "淨": "净",
    "淚": "泪",
    "淺": "浅",
    "渦": "涡",
    "測": "测",
    "渾": "浑",
    "湧": "涌",
    "溝": "沟",
    "滅": "灭",
    "滯": "滞",
    "滲": "渗",
    "滾": "滚",
    "滿": "满",
    "漁": "渔",
    "漲": "涨",
    "漣": "涟",
    "漸": "渐",
    "潛": "潜",
    "潤": "润",
    "潰": "溃",
    "澀": "涩",
    "澆": "浇",
    "澇": "涝",
    "澤": "泽",
    "濃": "浓",
    "濕": "湿",
    "濟": "济",
    "濤": "涛",
    "濫": "滥",
    "灣": "湾",
    "災": "灾",
    "為": "为",
    "烴": "烃",
    "無": "无",
    "煉": "炼",
    "煒": "炜",
    "煙": "烟",
    "煩": "烦",
    "燒": "烧",
    "燙": "烫",
    "營": "营",
    "燦": "灿",
    "燭": "烛",
    "爐": "炉",
    "爭": "争",
    "爺": "爷",
    "牆": "墙",
    "牽": "牵",
    "犧": "牺",
    "狀": "状",
    "獎": "奖",
    "獨": "独",
    "獲": "获",
    "獸": "兽",
    "獻": "献",
    "環": "环",
    "現": "现",
    "璽": "玺",
    "產": "产",
    "畢": "毕",
    "畫": "画",
    "異": "异",
    "當": "当",
    "疇": "畴",
    "療": "疗",
    "癢": "痒",
    "癥": "症",
    "發": "发",
    "皺": "皱",
    "盜": "盗",
    "盞": "盏",
    "盡": "尽",
    "監": "监",
    "盤": "盘",
    "盧": "卢",
    "眥": "眦",
    "眾": "众",
    "睏": "困",
    "矚": "瞩",
    "矯": "矫",
    "礦": "矿",
    "碼": "码",
    "磚": "砖",
    "確": "确",
    "礙": "碍",
    "禮": "礼",
    "禍": "祸",
    "禪": "禅",
    "離": "离",
    "種": "种",
    "穩": "稳",
    "積": "积",
    "穫": "获",
    "窩": "窝",
    "窪": "洼",
    "窮": "穷",
    "竄": "窜",
    "竅": "窍",
    "競": "竞",
    "筆": "笔",
    "築": "筑",
    "範": "范",
    "簡": "简",
    "簽": "签",
    "籌": "筹",
    "籠": "笼",
    "籤": "签",
    "類": "类",
    "糾": "纠",
    "紀": "纪",
    "約": "约",
    "紅": "红",
    "紋": "纹",
    "納": "纳",
    "紐": "纽",
    "純": "纯",
    "紙": "纸",
    "級": "级",
    "紛": "纷",
    "素": "素",
    "細": "细",
    "終": "终",
    "組": "组",
    "結": "结",
    "絕": "绝",
    "絡": "络",
    "給": "给",
    "統": "统",
    "絲": "丝",
    "綁": "绑",
    "經": "经",
    "綜": "综",
    "綠": "绿",
    "維": "维",
    "綱": "纲",
    "網": "网",
    "緊": "紧",
    "緒": "绪",
    "線": "线",
    "練": "练",
    "緻": "致",
    "縣": "县",
    "縫": "缝",
    "總": "总",
    "績": "绩",
    "繼": "继",
    "續": "续",
    "纏": "缠",
    "纖": "纤",
    "纜": "缆",
    "罰": "罚",
    "罷": "罢",
    "羅": "罗",
    "羥": "羟",
    "義": "义",
    "習": "习",
    "聖": "圣",
    "聞": "闻",
    "聯": "联",
    "聰": "聪",
    "聲": "声",
    "聽": "听",
    "職": "职",
    "肅": "肃",
    "脅": "胁",
    "脈": "脉",
    "脫": "脱",
    "腦": "脑",
    "腳": "脚",
    "腫": "肿",
    "膚": "肤",
    "膠": "胶",
    "膽": "胆",
    "臉": "脸",
    "臟": "脏",
    "臨": "临",
    "興": "兴",
    "舊": "旧",
    "艙": "舱",
    "艦": "舰",
    "藝": "艺",
    "節": "节",
    "莊": "庄",
    "華": "华",
    "萬": "万",
    "葉": "叶",
    "著": "著",
    "葷": "荤",
    "蒼": "苍",
    "蓋": "盖",
    "蔣": "蒋",
    "蔔": "卜",
    "蔥": "葱",
    "蕭": "萧",
    "薩": "萨",
    "薦": "荐",
    "藍": "蓝",
    "藝": "艺",
    "蘇": "苏",
    "處": "处",
    "虛": "虚",
    "號": "号",
    "虧": "亏",
    "蟲": "虫",
    "蠟": "蜡",
    "蠻": "蛮",
    "術": "术",
    "衝": "冲",
    "衛": "卫",
    "裝": "装",
    "裡": "里",
    "裏": "里",
    "補": "补",
    "製": "制",
    "複": "复",
    "見": "见",
    "規": "规",
    "視": "视",
    "覺": "觉",
    "覽": "览",
    "觀": "观",
    "觸": "触",
    "訂": "订",
    "計": "计",
    "訊": "讯",
    "討": "讨",
    "訓": "训",
    "記": "记",
    "訟": "讼",
    "訣": "诀",
    "訪": "访",
    "設": "设",
    "許": "许",
    "訴": "诉",
    "診": "诊",
    "詐": "诈",
    "該": "该",
    "詳": "详",
    "試": "试",
    "詩": "诗",
    "話": "话",
    "誠": "诚",
    "誕": "诞",
    "誘": "诱",
    "語": "语",
    "誤": "误",
    "說": "说",
    "誰": "谁",
    "課": "课",
    "調": "调",
    "談": "谈",
    "請": "请",
    "諸": "诸",
    "諾": "诺",
    "謀": "谋",
    "謂": "谓",
    "謊": "谎",
    "謝": "谢",
    "謠": "谣",
    "證": "证",
    "識": "识",
    "譜": "谱",
    "警": "警",
    "譯": "译",
    "議": "议",
    "護": "护",
    "讀": "读",
    "變": "变",
    "讓": "让",
    "讚": "赞",
    "豈": "岂",
    "豬": "猪",
    "貓": "猫",
    "貝": "贝",
    "貞": "贞",
    "負": "负",
    "財": "财",
    "貢": "贡",
    "貧": "贫",
    "貨": "货",
    "販": "贩",
    "貪": "贪",
    "貫": "贯",
    "責": "责",
    "貯": "贮",
    "貴": "贵",
    "貸": "贷",
    "費": "费",
    "貼": "贴",
    "貿": "贸",
    "賀": "贺",
    "賁": "贲",
    "賂": "赂",
    "賃": "赁",
    "資": "资",
    "賈": "贾",
    "賊": "贼",
    "賓": "宾",
    "賬": "账",
    "賣": "卖",
    "賠": "赔",
    "賦": "赋",
    "質": "质",
    "賴": "赖",
    "賺": "赚",
    "購": "购",
    "贈": "赠",
    "贊": "赞",
    "贏": "赢",
    "趕": "赶",
    "趙": "赵",
    "趨": "趋",
    "躍": "跃",
    "車": "车",
    "軌": "轨",
    "軍": "军",
    "軟": "软",
    "軸": "轴",
    "較": "较",
    "輔": "辅",
    "輕": "轻",
    "輛": "辆",
    "輝": "辉",
    "輪": "轮",
    "輯": "辑",
    "輸": "输",
    "轄": "辖",
    "轉": "转",
    "辭": "辞",
    "辯": "辩",
    "農": "农",
    "迴": "回",
    "這": "这",
    "連": "连",
    "週": "周",
    "進": "进",
    "運": "运",
    "過": "过",
    "達": "达",
    "違": "违",
    "遙": "遥",
    "遞": "递",
    "適": "适",
    "遷": "迁",
    "選": "选",
    "遺": "遗",
    "遼": "辽",
    "邁": "迈",
    "還": "还",
    "邊": "边",
    "鄧": "邓",
    "鄭": "郑",
    "鄰": "邻",
    "醫": "医",
    "醬": "酱",
    "釀": "酿",
    "釋": "释",
    "釐": "厘",
    "鈔": "钞",
    "鈕": "钮",
    "鈞": "钧",
    "鈣": "钙",
    "鈴": "铃",
    "鉛": "铅",
    "鉤": "钩",
    "銀": "银",
    "銅": "铜",
    "銘": "铭",
    "銷": "销",
    "鋁": "铝",
    "鋒": "锋",
    "鋪": "铺",
    "鋼": "钢",
    "錄": "录",
    "錢": "钱",
    "錦": "锦",
    "錨": "锚",
    "錯": "错",
    "鍊": "链",
    "鍋": "锅",
    "鍛": "锻",
    "鍵": "键",
    "鎖": "锁",
    "鎮": "镇",
    "鏈": "链",
    "鏡": "镜",
    "鐘": "钟",
    "鐵": "铁",
    "鑑": "鉴",
    "鑒": "鉴",
    "長": "长",
    "門": "门",
    "閃": "闪",
    "閉": "闭",
    "開": "开",
    "閑": "闲",
    "間": "间",
    "閣": "阁",
    "閥": "阀",
    "閱": "阅",
    "關": "关",
    "隊": "队",
    "陽": "阳",
    "陰": "阴",
    "陣": "阵",
    "階": "阶",
    "際": "际",
    "陸": "陆",
    "隻": "只",
    "雜": "杂",
    "雙": "双",
    "雞": "鸡",
    "離": "离",
    "難": "难",
    "電": "电",
    "霧": "雾",
    "靈": "灵",
    "靜": "静",
    "面": "面",
    "韋": "韦",
    "韓": "韩",
    "韻": "韵",
    "頁": "页",
    "頂": "顶",
    "項": "项",
    "順": "顺",
    "須": "须",
    "頑": "顽",
    "頓": "顿",
    "預": "预",
    "頒": "颁",
    "領": "领",
    "頗": "颇",
    "頭": "头",
    "頰": "颊",
    "頻": "频",
    "顆": "颗",
    "題": "题",
    "額": "额",
    "顯": "显",
    "風": "风",
    "飛": "飞",
    "飢": "饥",
    "飯": "饭",
    "飲": "饮",
    "飾": "饰",
    "餘": "余",
    "餅": "饼",
    "館": "馆",
    "饋": "馈",
    "馬": "马",
    "駐": "驻",
    "騎": "骑",
    "騙": "骗",
    "驅": "驱",
    "驚": "惊",
    "體": "体",
    "鬆": "松",
    "魚": "鱼",
    "魯": "鲁",
    "鮮": "鲜",
    "鳥": "鸟",
    "鳴": "鸣",
    "麗": "丽",
    "麥": "麦",
    "黃": "黄",
    "點": "点",
    "黨": "党",
    "齊": "齐",
    "齒": "齿",
    "龍": "龙",
})

_OPENCC_CONVERTER = None
_OPENCC_UNAVAILABLE = False

STOCK_MARKET_MEIGU_CONTEXTS = (
    "首次",
    "市场",
    "触及",
    "涨幅",
    "涨势",
    "估值",
    "指数",
    "行情",
    "反弹",
    "走高",
    "走低",
    "大涨",
    "大跌",
)


def _convert_with_opencc(text: str) -> str | None:
    global _OPENCC_CONVERTER, _OPENCC_UNAVAILABLE
    if _OPENCC_UNAVAILABLE:
        return None
    if _OPENCC_CONVERTER is None:
        try:
            from opencc import OpenCC  # type: ignore
        except Exception:
            _OPENCC_UNAVAILABLE = True
            return None
        _OPENCC_CONVERTER = OpenCC("t2s")
    try:
        return _OPENCC_CONVERTER.convert(text)
    except Exception:
        return None


def to_simplified_chinese(text: str) -> str:
    """Normalize Chinese text to Simplified Chinese while preserving non-CJK terms."""

    sample = str(text or "")
    if not sample:
        return sample

    normalized = _convert_with_opencc(sample) or sample
    for traditional, simplified in TRADITIONAL_PHRASE_MAP.items():
        normalized = normalized.replace(traditional, simplified)
    return normalized.translate(TRADITIONAL_CHAR_MAP)


def has_traditional_chinese(text: str) -> bool:
    sample = str(text or "")
    if not sample:
        return False
    return to_simplified_chinese(sample) != sample


def _is_common_capitalized_word(term: str) -> bool:
    return term.lower() in COMMON_CAPITALIZED_WORDS


def _looks_like_joined_english_sentence(term: str) -> bool:
    sample = str(term or "").strip()
    lower_sample = sample.lower()
    return (
        len(sample) > MAX_SINGLE_CAPITALIZED_TERM_LENGTH
        and bool(re.fullmatch(r"[A-Z][a-z]+", sample))
    ) or (
        len(sample) >= 12
        and bool(re.fullmatch(r"[A-Za-z]+", sample))
        and any(lower_sample.startswith(marker) for marker in JOINED_ENGLISH_SENTENCE_MARKERS)
    )


def extract_preserve_terms(text, max_terms=12):
    """Extract likely proper nouns, acronyms, and numeric tokens to preserve."""

    sample = str(text or "")
    if not sample:
        return []

    matches = []
    seen_spans = []

    for pattern in TERM_PATTERNS:
        for match in pattern.finditer(sample):
            term = str(match.group(0) or "").strip()
            if not term:
                continue
            if pattern is SINGLE_CAPITALIZED_PATTERN:
                if _is_common_capitalized_word(term):
                    continue
            if _looks_like_joined_english_sentence(term):
                continue
            span = match.span()
            if any(span[0] < other_end and span[1] > other_start for other_start, other_end in seen_spans):
                continue
            matches.append((span[0], span[1], term))
            seen_spans.append(span)

    matches.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    preserve_terms = []
    seen_terms = set()
    for _start, _end, term in matches:
        if term in seen_terms:
            continue
        seen_terms.add(term)
        preserve_terms.append(term)
        if len(preserve_terms) >= max_terms:
            break

    preserve_terms.sort(key=len, reverse=True)
    return preserve_terms


def mask_preserved_terms(text, preserve_terms=None):
    """Replace preserved terms with placeholders and return the replacement map."""

    sample = str(text or "")
    if not sample:
        return "", {}

    terms = list(preserve_terms or extract_preserve_terms(sample))
    if not terms:
        return sample, {}

    placeholders = {}
    masked = sample
    for index, term in enumerate(terms, start=1):
        if not term:
            continue
        placeholder = f"[[TERM_{index}]]"
        placeholders[placeholder] = term
        masked = re.sub(re.escape(term), placeholder, masked)

    return masked, placeholders


def restore_preserved_terms(text, placeholders=None):
    """Restore placeholder tokens to their original terms."""

    sample = str(text or "")
    if not sample or not placeholders:
        return sample

    restored = sample
    for placeholder, term in sorted(placeholders.items(), key=lambda item: len(item[0]), reverse=True):
        restored = restored.replace(placeholder, term)
    return restored


NUMERIC_REFERENCE_TERM_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])[$￥¥]?\d+(?:[.,]\d+)*(?:(?:万|亿|千|百)?(?:美元|美分|元)|[万亿千百%年个次股])?"
)

REFERENCE_NUMERIC_INSERTION_PUNCTUATION = "，,。.!?！？；;：:"
MAX_REFERENCE_NUMERIC_BRIDGE_CHARS = 3
MAX_REFERENCE_CONTEXT_ANCHOR_CHARS = 8
MIN_REFERENCE_CONTEXT_ANCHOR_CHARS = 2


def _visible_reference_text(text: str) -> str:
    return re.sub(r"[\s，。！？；：、“”‘’,.!?;:()\[\]{}\"'…·-]", "", str(text or ""))


def _visible_reference_text_with_indices(text: str) -> tuple[str, list[int]]:
    visible_chars = []
    visible_indices = []
    for index, char in enumerate(str(text or "")):
        if _visible_reference_text(char):
            visible_chars.append(char)
            visible_indices.append(index)
    return "".join(visible_chars), visible_indices


def _numeric_reference_parts(term: str) -> tuple[str, str]:
    sample = str(term or "")
    digits = re.sub(r"\D", "", sample)
    suffix_match = re.search(r"(?:\d|[.,])([^\d.,]*)$", sample)
    suffix = suffix_match.group(1) if suffix_match else ""
    return digits, suffix


def _find_literal_tail_insert_index(repaired: str, visible_indices, before_pos: int, literal_tail: str):
    if not literal_tail:
        return None

    visible_start = visible_indices[before_pos] if before_pos < len(visible_indices) else 0
    search_from = max(0, visible_start - len(literal_tail) - 2)
    literal_index = repaired.find(literal_tail, search_from)
    while literal_index != -1:
        literal_end = literal_index + len(literal_tail)
        if literal_index <= visible_start < literal_end:
            return literal_end
        if literal_index > visible_start:
            break
        literal_index = repaired.find(literal_tail, literal_index + 1)
    return None


def _repair_missing_numeric_inside_reference_clause(repaired: str, reference: str, match) -> str:
    repaired_visible, repaired_indices = _visible_reference_text_with_indices(repaired)
    if len(repaired_visible) < 4:
        return repaired

    before_segment = reference[:match.start()]
    after_segment = reference[match.end():]
    before_visible, before_indices = _visible_reference_text_with_indices(before_segment)
    after_visible, after_indices = _visible_reference_text_with_indices(after_segment)
    if len(after_visible) < MIN_REFERENCE_CONTEXT_ANCHOR_CHARS:
        return repaired

    before_lengths = []
    max_before_len = min(MAX_REFERENCE_CONTEXT_ANCHOR_CHARS, len(before_visible))
    if max_before_len >= MIN_REFERENCE_CONTEXT_ANCHOR_CHARS:
        before_lengths = range(max_before_len, MIN_REFERENCE_CONTEXT_ANCHOR_CHARS - 1, -1)
    elif not before_visible:
        before_lengths = [0]

    for before_len in before_lengths:
        before_offset = len(before_visible) - before_len
        before_anchor = before_visible[before_offset:] if before_len else ""
        literal_tail = ""
        if before_len and before_indices:
            literal_tail = reference[before_indices[before_offset]:match.start()]

        max_after_offset = min(MAX_REFERENCE_NUMERIC_BRIDGE_CHARS, len(after_visible) - MIN_REFERENCE_CONTEXT_ANCHOR_CHARS)
        for after_offset in range(max_after_offset + 1):
            max_after_len = min(MAX_REFERENCE_CONTEXT_ANCHOR_CHARS, len(after_visible) - after_offset)
            for after_len in range(max_after_len, MIN_REFERENCE_CONTEXT_ANCHOR_CHARS - 1, -1):
                after_anchor = after_visible[after_offset:after_offset + after_len]
                if not after_anchor:
                    continue

                search_from = 0
                while True:
                    if before_anchor:
                        before_pos = repaired_visible.find(before_anchor, search_from)
                        if before_pos < 0:
                            break
                        before_end = before_pos + before_len
                    else:
                        before_pos = 0
                        before_end = 0

                    after_pos = repaired_visible.find(after_anchor, before_end)
                    if after_pos == before_end:
                        if after_offset < len(after_indices):
                            insertion_end = match.end() + after_indices[after_offset]
                        else:
                            insertion_end = match.end()
                        insertion_text = reference[match.start():insertion_end]
                        if not insertion_text or not _visible_reference_text(insertion_text):
                            break

                        if before_end > 0:
                            insert_index = repaired_indices[before_end - 1] + 1
                            literal_insert_index = _find_literal_tail_insert_index(
                                repaired,
                                repaired_indices,
                                before_pos,
                                literal_tail,
                            )
                            if literal_insert_index is not None:
                                insert_index = literal_insert_index
                        else:
                            insert_index = 0

                        if (
                                insertion_text[-1:] in REFERENCE_NUMERIC_INSERTION_PUNCTUATION
                                and repaired[insert_index:insert_index + 1] in REFERENCE_NUMERIC_INSERTION_PUNCTUATION
                        ):
                            insertion_text = insertion_text[:-1]
                        return f"{repaired[:insert_index]}{insertion_text}{repaired[insert_index:]}"

                    if not before_anchor:
                        break
                    search_from = before_pos + 1

    return repaired


def repair_numeric_reference_terms(text, reference_text):
    repaired = str(text or "")
    reference = str(reference_text or "")
    if not repaired or not reference:
        return repaired

    reference_terms = NUMERIC_REFERENCE_TERM_PATTERN.findall(reference)
    if not reference_terms:
        return repaired

    repaired_terms = NUMERIC_REFERENCE_TERM_PATTERN.findall(repaired)
    for reference_term in reference_terms:
        if reference_term in repaired:
            continue
        reference_digits, reference_suffix = _numeric_reference_parts(reference_term)
        if not reference_digits or len(reference_digits) < 2:
            continue

        candidates = []
        for term in repaired_terms:
            term_digits, term_suffix = _numeric_reference_parts(term)
            if not term_digits or term == reference_term:
                continue
            if reference_suffix and term_suffix and reference_suffix != term_suffix:
                continue
            if term_digits in reference_digits and len(term_digits) < len(reference_digits):
                candidates.append(term)

        if len(candidates) != 1:
            continue
        repaired = repaired.replace(candidates[0], reference_term, 1)
        repaired_terms = NUMERIC_REFERENCE_TERM_PATTERN.findall(repaired)

    return repaired


def repair_missing_numeric_reference_terms(text, reference_text):
    repaired = str(text or "")
    reference = str(reference_text or "")
    if not repaired or not reference:
        return repaired

    repaired_visible = _visible_reference_text(repaired)
    if len(repaired_visible) < 6:
        return repaired

    for match in NUMERIC_REFERENCE_TERM_PATTERN.finditer(reference):
        term = match.group(0)
        if not term or term in repaired:
            continue
        term_digits, _term_suffix = _numeric_reference_parts(term)
        if len(term_digits) < 2:
            continue

        clause_repaired = _repair_missing_numeric_inside_reference_clause(repaired, reference, match)
        if clause_repaired != repaired:
            return clause_repaired

        before_visible = _visible_reference_text(reference[:match.start()])
        if not before_visible.endswith(repaired_visible):
            continue

        trailing = reference[match.end():match.end() + 1]
        if trailing not in "，,。.!?！？；;":
            trailing = ""
        if trailing and repaired.endswith(trailing):
            trailing = ""
        return f"{repaired}{term}{trailing}"

    return repaired



def repair_reference_subtitle_text(text, reference_text):
    """Restore high-confidence reference terms that ASR/LLM alignment truncated."""

    repaired = str(text or "")
    reference = str(reference_text or "")
    if not repaired:
        return repaired

    if reference:
        for term in PERSON_NAME_PATTERN.findall(reference):
            first_token = term.split()[0]
            if first_token not in repaired:
                continue
            pattern = re.compile(
                rf"{ASCII_LEFT_BOUNDARY}{re.escape(first_token)}(?!\s+{re.escape(term.split()[1])}){ASCII_RIGHT_BOUNDARY}"
            )
            repaired = pattern.sub(term, repaired)

    stock_context = "|".join(re.escape(item) for item in STOCK_MARKET_MEIGU_CONTEXTS)
    repaired = re.sub(rf"每股(?=(?:{stock_context}))", "美股", repaired)

    if reference:
        for canonical, variants in REFERENCE_HOMOPHONE_CORRECTIONS.items():
            if canonical not in reference or canonical in repaired:
                continue
            for variant in variants:
                repaired = repaired.replace(variant, canonical)

    repaired = repair_numeric_reference_terms(repaired, reference)
    repaired = repair_missing_numeric_reference_terms(repaired, reference)
    return repaired
