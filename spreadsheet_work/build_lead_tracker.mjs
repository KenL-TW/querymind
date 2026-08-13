import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "../outputs/lead_bd_template";
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "User" });

const dash = workbook.worksheets.add("Dashboard");
const leads = workbook.worksheets.add("Leads");
const log = workbook.worksheets.add("Follow-up Log");
const settings = workbook.worksheets.add("Settings");

const MAX_LEADS = 200;
const LEAD_FIRST = 7;
const LEAD_LAST = LEAD_FIRST + MAX_LEADS - 1;
const MAX_LOGS = 300;
const LOG_FIRST = 7;
const LOG_LAST = LOG_FIRST + MAX_LOGS - 1;

const theme = {
  ink: "#1F2937",
  muted: "#6B7280",
  line: "#CBD5E1",
  softLine: "#E5E7EB",
  blue: "#1D4ED8",
  blueDark: "#1E3A8A",
  blueSoft: "#DBEAFE",
  green: "#047857",
  greenSoft: "#D1FAE5",
  amber: "#B45309",
  amberSoft: "#FEF3C7",
  red: "#B91C1C",
  redSoft: "#FEE2E2",
  graySoft: "#F8FAFC",
  purple: "#6D28D9",
  purpleSoft: "#EDE9FE",
  teal: "#0F766E",
  tealSoft: "#CCFBF1",
};

function date(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}

function styleTitle(sheet, range, title, subtitle) {
  sheet.showGridLines = false;
  sheet.getRange(range).merge();
  sheet.getRange(range).values = [[title]];
  sheet.getRange(range).format = {
    fill: theme.blueDark,
    font: { bold: true, color: "#FFFFFF", size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  const row = Number(range.match(/\d+/)[0]) + 1;
  sheet.getRange(`A${row}:I${row}`).merge();
  sheet.getRange(`A${row}:I${row}`).values = [[subtitle]];
  sheet.getRange(`A${row}:I${row}`).format = {
    fill: theme.blueSoft,
    font: { color: theme.ink, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
  };
}

function styleHeader(range) {
  range.format = {
    fill: theme.blue,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: theme.line },
  };
}

function styleTableBody(range) {
  range.format = {
    fill: "#FFFFFF",
    font: { color: theme.ink, size: 10 },
    verticalAlignment: "top",
    wrapText: true,
    borders: {
      insideHorizontal: { style: "thin", color: theme.softLine },
      insideVertical: { style: "thin", color: theme.softLine },
      bottom: { style: "thin", color: theme.line },
    },
  };
}

function setValidation(sheet, range, values) {
  sheet.getRange(range).dataValidation = {
    rule: { type: "list", values },
  };
}

function setScoreValidation(sheet, range) {
  sheet.getRange(range).dataValidation = {
    rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 },
  };
}

const stages = [
  ["新名單", 0.05, "剛進入名單，尚未有效接觸。"],
  ["已聯繫", 0.1, "已完成第一次接觸或發送訊息。"],
  ["初步資格確認", 0.2, "確認是否符合服務範圍、預算與基本需求。"],
  ["需求訪談", 0.35, "已安排或完成需求訪談。"],
  ["方案/估價", 0.5, "正在整理方案、估價或技術可行性。"],
  ["提案/報價", 0.65, "已送出正式提案或報價。"],
  ["議價/合約", 0.8, "價格、合約、付款或時程協商中。"],
  ["成交", 1, "已確認合作。"],
  ["流失", 0, "確認不合作或名單無效。"],
  ["暫緩", 0.15, "短期不推進，但未完全流失。"],
];
const leadStatuses = [
  "未聯繫",
  "已聯繫未回覆",
  "等待客戶回覆",
  "需再次跟進",
  "高意願",
  "低意願",
  "無效名單",
  "暫緩",
];
const sourceCategories = [
  "官網表單",
  "獨立官網名單",
  "既有 shop.com 客戶",
  "尚未導入電商平台商家",
  "轉介紹",
  "主動開發",
];
const needTypes = ["形象官網", "電商網站", "系統開發", "網站改版", "維護/優化", "多項需求"];
const companySizes = ["個人/微型", "1-10", "11-50", "51-200", "201+"];
const lostReasons = [
  "預算不足",
  "時程不符",
  "已選其他供應商",
  "需求暫停",
  "無決策權",
  "無回覆",
  "非目標客群",
];
const contactTypes = ["Email", "電話", "LINE", "會議", "視訊", "現場拜訪"];
const outcomeStatuses = ["已完成", "等待回覆", "需追蹤", "已約下一步", "暫緩"];

// Settings
styleTitle(
  settings,
  "A1:I1",
  "設定與評分邏輯",
  "集中維護下拉選單、BANTC 權重與銷售階段機率。需要調整分類時先改這張表。"
);
settings.getRange("A4:C4").values = [["銷售階段", "成交機率", "定義"]];
settings.getRange("E4:F4").values = [["BANTC 面向", "權重"]];
settings.getRange("H4:H4").values = [["Lead 狀態"]];
settings.getRange("A5:C14").values = stages;
settings.getRange("E5:F9").values = [
  ["Budget 預算", 0.25],
  ["Authority 決策權", 0.2],
  ["Need 需求明確度", 0.25],
  ["Timeline 急迫性", 0.2],
  ["Competition/Fit 競爭與適配度", 0.1],
];
settings.getRange("H5:H12").values = leadStatuses.map((x) => [x]);
settings.getRange("A17:A22").values = sourceCategories.map((x) => [x]);
settings.getRange("C17:C22").values = needTypes.map((x) => [x]);
settings.getRange("E17:E21").values = companySizes.map((x) => [x]);
settings.getRange("G17:G23").values = lostReasons.map((x) => [x]);
settings.getRange("I17:I22").values = contactTypes.map((x) => [x]);
settings.getRange("K17:K21").values = outcomeStatuses.map((x) => [x]);
settings.getRange("A16").values = [["來源分類"]];
settings.getRange("C16").values = [["需求類型"]];
settings.getRange("E16").values = [["公司規模"]];
settings.getRange("G16").values = [["流失原因"]];
settings.getRange("I16").values = [["接觸方式"]];
settings.getRange("K16").values = [["跟進結果"]];
styleHeader(settings.getRange("A4:C4"));
styleHeader(settings.getRange("E4:F4"));
styleHeader(settings.getRange("H4:H4"));
styleHeader(settings.getRange("A16:K16"));
settings.getRange("A5:C14").format = { borders: { preset: "inside", style: "thin", color: theme.softLine } };
settings.getRange("E5:F9").format = { borders: { preset: "inside", style: "thin", color: theme.softLine } };
settings.getRange("B5:B14").format.numberFormat = "0%";
settings.getRange("F5:F9").format.numberFormat = "0%";
settings.getRange("A1:K24").format.font = { name: "Aptos" };
settings.getRange("A:A").format.columnWidth = 22;
settings.getRange("B:B").format.columnWidth = 12;
settings.getRange("C:C").format.columnWidth = 42;
settings.getRange("E:E").format.columnWidth = 26;
settings.getRange("G:G").format.columnWidth = 22;
settings.getRange("I:I").format.columnWidth = 16;
settings.getRange("K:K").format.columnWidth = 16;

// Leads
styleTitle(
  leads,
  "A1:I1",
  "潛在客戶主表",
  "每列是一個 Lead。請優先填寫白色欄位，分數、等級、機率、逾期與建議欄位會依公式更新。"
);
const leadHeaders = [
  "Lead ID",
  "建立日期",
  "來源分類",
  "來源細節",
  "公司名稱",
  "聯絡人",
  "職稱",
  "電話",
  "Email",
  "LINE",
  "地區",
  "產業",
  "公司規模",
  "現有網站/通路",
  "需求類型",
  "預算 1-5",
  "決策權 1-5",
  "需求明確 1-5",
  "急迫性 1-5",
  "競爭/適配 1-5",
  "總分",
  "等級",
  "銷售階段",
  "Lead 狀態",
  "成交機率",
  "預估金額",
  "下次跟進日",
  "最後跟進日",
  "未更新天數",
  "逾期",
  "結案日期",
  "流失原因",
  "負責人",
  "備註",
  "BD 建議",
];
leads.getRange("A6:AI6").values = [leadHeaders];
styleHeader(leads.getRange("A6:AI6"));

const sampleLeads = [
  [
    "L-0001",
    date(2026, 1, 15),
    "官網表單",
    "品牌官網詢價",
    "和森生活選品",
    "陳小姐",
    "行銷經理",
    "02-2345-0001",
    "marketing@hosen.example",
    "@hosenlife",
    "台北",
    "零售選品",
    "11-50",
    "WordPress 舊站",
    "形象官網",
    4,
    4,
    5,
    4,
    4,
    null,
    null,
    "成交",
    "高意願",
    null,
    180000,
    date(2026, 2, 15),
    null,
    null,
    null,
    date(2026, 2, 10),
    "",
    "User",
    "已確認改版與品牌頁需求。",
    null,
  ],
  [
    "L-0002",
    date(2026, 2, 20),
    "既有 shop.com 客戶",
    "既有客戶想做獨立官網",
    "沐澄保養",
    "林先生",
    "創辦人",
    "04-2233-0002",
    "founder@mucheng.example",
    "@mucheng",
    "台中",
    "美妝保養",
    "1-10",
    "shop.com",
    "電商網站",
    3,
    5,
    4,
    3,
    4,
    null,
    null,
    "提案/報價",
    "等待客戶回覆",
    null,
    260000,
    date(2026, 6, 18),
    null,
    null,
    null,
    null,
    "",
    "User",
    "需要比較平台抽成與自建站成本。",
    null,
  ],
  [
    "L-0003",
    date(2026, 3, 5),
    "尚未導入電商平台商家",
    "Instagram 私訊名單",
    "山日咖啡",
    "吳小姐",
    "店長",
    "07-5566-0003",
    "shop@sunhill.example",
    "@sunhillcoffee",
    "高雄",
    "餐飲",
    "1-10",
    "IG / Google 商家",
    "電商網站",
    2,
    4,
    4,
    5,
    3,
    null,
    null,
    "需求訪談",
    "需再次跟進",
    null,
    120000,
    date(2026, 6, 20),
    null,
    null,
    null,
    null,
    "",
    "User",
    "急著上架禮盒預購，預算需確認。",
    null,
  ],
  [
    "L-0004",
    date(2026, 3, 18),
    "獨立官網名單",
    "官網速度慢且無轉換追蹤",
    "金曜工業",
    "張先生",
    "業務副理",
    "03-4455-0004",
    "sales@kinyo.example",
    "",
    "桃園",
    "製造業",
    "51-200",
    "舊版企業官網",
    "網站改版",
    2,
    2,
    3,
    2,
    2,
    null,
    null,
    "流失",
    "低意願",
    null,
    150000,
    null,
    null,
    null,
    null,
    date(2026, 4, 10),
    "預算不足",
    "User",
    "年度預算不足，明年可再培育。",
    null,
  ],
  [
    "L-0005",
    date(2026, 4, 3),
    "官網表單",
    "需要會員與訂單整合",
    "佳禾食品",
    "黃小姐",
    "營運主管",
    "02-7788-0005",
    "ops@jiahe.example",
    "@jiahefood",
    "新北",
    "食品",
    "51-200",
    "自架購物車",
    "系統開發",
    5,
    4,
    5,
    4,
    4,
    null,
    null,
    "議價/合約",
    "高意願",
    null,
    520000,
    date(2026, 6, 24),
    null,
    null,
    null,
    null,
    "",
    "User",
    "需確認 ERP API 與分期付款。",
    null,
  ],
  [
    "L-0006",
    date(2026, 4, 26),
    "主動開發",
    "LinkedIn 開發",
    "瑞澤顧問",
    "許先生",
    "合夥人",
    "02-8899-0006",
    "partner@ruize.example",
    "",
    "台北",
    "顧問服務",
    "11-50",
    "無官網",
    "形象官網",
    3,
    3,
    3,
    2,
    3,
    null,
    null,
    "已聯繫",
    "已聯繫未回覆",
    null,
    90000,
    date(2026, 6, 12),
    null,
    null,
    null,
    null,
    "",
    "User",
    "第一次聯繫後尚未回覆。",
    null,
  ],
  [
    "L-0007",
    date(2026, 5, 9),
    "轉介紹",
    "舊客戶介紹",
    "築境室內設計",
    "鄭小姐",
    "負責人",
    "02-6677-0007",
    "hello@zhu-jing.example",
    "@zjdesign",
    "台北",
    "室內設計",
    "1-10",
    "Wix",
    "形象官網",
    4,
    5,
    4,
    5,
    5,
    null,
    null,
    "成交",
    "高意願",
    null,
    220000,
    null,
    null,
    null,
    null,
    date(2026, 6, 1),
    "",
    "User",
    "已確認網站與作品集改版。",
    null,
  ],
  [
    "L-0008",
    date(2026, 5, 22),
    "尚未導入電商平台商家",
    "市集品牌名單",
    "日日織物",
    "周小姐",
    "品牌主理人",
    "06-2211-0008",
    "brand@dailyweave.example",
    "@dailyweave",
    "台南",
    "手作品牌",
    "個人/微型",
    "蝦皮 / IG",
    "電商網站",
    2,
    4,
    3,
    3,
    3,
    null,
    null,
    "初步資格確認",
    "等待客戶回覆",
    null,
    80000,
    date(2026, 6, 25),
    null,
    null,
    null,
    null,
    "",
    "User",
    "需要教育自建站成本與營運門檻。",
    null,
  ],
  [
    "L-0009",
    date(2026, 6, 3),
    "既有 shop.com 客戶",
    "想串接會員資料",
    "康沛運動",
    "郭先生",
    "電商主管",
    "04-9988-0009",
    "ecom@compei.example",
    "@compei",
    "台中",
    "運動用品",
    "11-50",
    "shop.com",
    "系統開發",
    4,
    4,
    5,
    4,
    3,
    null,
    null,
    "方案/估價",
    "需再次跟進",
    null,
    360000,
    date(2026, 6, 22),
    null,
    null,
    null,
    null,
    "",
    "User",
    "要釐清會員資料匯入與再行銷規格。",
    null,
  ],
  [
    "L-0010",
    date(2026, 6, 15),
    "官網表單",
    "詢問品牌官網與 SEO",
    "青木法律",
    "李小姐",
    "行政主任",
    "02-1122-0010",
    "admin@aoki-law.example",
    "",
    "台北",
    "專業服務",
    "11-50",
    "無官網",
    "形象官網",
    3,
    3,
    4,
    4,
    4,
    null,
    null,
    "新名單",
    "未聯繫",
    null,
    160000,
    date(2026, 6, 21),
    null,
    null,
    null,
    null,
    "",
    "User",
    "需盡快初次聯繫。",
    null,
  ],
];
leads.getRange(`A${LEAD_FIRST}:AI${LEAD_FIRST + sampleLeads.length - 1}`).values = sampleLeads;

// Lead formulas
leads.getRange(`U${LEAD_FIRST}`).formulas = [[`=IF(COUNTA(P${LEAD_FIRST}:T${LEAD_FIRST})=0,"",ROUND((P${LEAD_FIRST}*25+Q${LEAD_FIRST}*20+R${LEAD_FIRST}*25+S${LEAD_FIRST}*20+T${LEAD_FIRST}*10)/5,0))`]];
leads.getRange(`U${LEAD_FIRST}:U${LEAD_LAST}`).fillDown();
leads.getRange(`V${LEAD_FIRST}`).formulas = [[`=IF(U${LEAD_FIRST}="","",IF(U${LEAD_FIRST}>=80,"A",IF(U${LEAD_FIRST}>=60,"B","C")))`]];
leads.getRange(`V${LEAD_FIRST}:V${LEAD_LAST}`).fillDown();
leads.getRange(`Y${LEAD_FIRST}`).formulas = [[`=IF(W${LEAD_FIRST}="","",XLOOKUP(W${LEAD_FIRST},'Settings'!$A$5:$A$14,'Settings'!$B$5:$B$14,0))`]];
leads.getRange(`Y${LEAD_FIRST}:Y${LEAD_LAST}`).fillDown();
leads.getRange(`AB${LEAD_FIRST}`).formulas = [[`=IF(COUNTIF('Follow-up Log'!$B$${LOG_FIRST}:$B$${LOG_LAST},A${LEAD_FIRST})=0,"",MAXIFS('Follow-up Log'!$A$${LOG_FIRST}:$A$${LOG_LAST},'Follow-up Log'!$B$${LOG_FIRST}:$B$${LOG_LAST},A${LEAD_FIRST}))`]];
leads.getRange(`AB${LEAD_FIRST}:AB${LEAD_LAST}`).fillDown();
leads.getRange(`AC${LEAD_FIRST}`).formulas = [[`=IF(AB${LEAD_FIRST}="","",TODAY()-AB${LEAD_FIRST})`]];
leads.getRange(`AC${LEAD_FIRST}:AC${LEAD_LAST}`).fillDown();
leads.getRange(`AD${LEAD_FIRST}`).formulas = [[`=IF(OR(W${LEAD_FIRST}="成交",W${LEAD_FIRST}="流失",AA${LEAD_FIRST}=""),"",IF(AA${LEAD_FIRST}<TODAY(),"是","否"))`]];
leads.getRange(`AD${LEAD_FIRST}:AD${LEAD_LAST}`).fillDown();
leads.getRange(`AI${LEAD_FIRST}`).formulas = [[`=IF(A${LEAD_FIRST}="","",IF(AD${LEAD_FIRST}="是","立即跟進",IF(V${LEAD_FIRST}="A","優先安排需求訪談/提案",IF(V${LEAD_FIRST}="B","維持節奏並確認預算/決策者","低成本培育或待條件成熟"))))`]];
leads.getRange(`AI${LEAD_FIRST}:AI${LEAD_LAST}`).fillDown();

styleTableBody(leads.getRange(`A${LEAD_FIRST}:AI${LEAD_LAST}`));
leads.tables.add(`A6:AI${LEAD_LAST}`, true, "LeadsTable");
leads.freezePanes.freezeRows(6);
leads.freezePanes.freezeColumns(5);
leads.getRange(`B${LEAD_FIRST}:B${LEAD_LAST}`).setNumberFormat("yyyy-mm-dd");
leads.getRange(`Y${LEAD_FIRST}:Y${LEAD_LAST}`).setNumberFormat("0%");
leads.getRange(`Z${LEAD_FIRST}:Z${LEAD_LAST}`).setNumberFormat("#,##0");
leads.getRange(`AA${LEAD_FIRST}:AB${LEAD_LAST}`).setNumberFormat("yyyy-mm-dd");
leads.getRange(`AC${LEAD_FIRST}:AC${LEAD_LAST}`).setNumberFormat("0");
leads.getRange(`AE${LEAD_FIRST}:AE${LEAD_LAST}`).setNumberFormat("yyyy-mm-dd");
leads.getRange("P:T").format.horizontalAlignment = "center";
leads.getRange("U:Y").format.horizontalAlignment = "center";
leads.getRange("AD:AD").format.horizontalAlignment = "center";
leads.getRange("A:A").format.columnWidth = 12;
leads.getRange("B:B").format.columnWidth = 12;
leads.getRange("C:D").format.columnWidth = 20;
leads.getRange("E:F").format.columnWidth = 18;
leads.getRange("G:J").format.columnWidth = 16;
leads.getRange("K:O").format.columnWidth = 18;
leads.getRange("P:T").format.columnWidth = 11;
leads.getRange("U:Y").format.columnWidth = 12;
leads.getRange("Z:AF").format.columnWidth = 14;
leads.getRange("AG:AI").format.columnWidth = 24;
leads.getRange("A1:AI206").format.font = { name: "Aptos" };
leads.getRange("1:2").format.rowHeight = 24;
leads.getRange("6:6").format.rowHeight = 36;

setValidation(leads, `C${LEAD_FIRST}:C${LEAD_LAST}`, sourceCategories);
setValidation(leads, `M${LEAD_FIRST}:M${LEAD_LAST}`, companySizes);
setValidation(leads, `O${LEAD_FIRST}:O${LEAD_LAST}`, needTypes);
setScoreValidation(leads, `P${LEAD_FIRST}:T${LEAD_LAST}`);
setValidation(leads, `W${LEAD_FIRST}:W${LEAD_LAST}`, stages.map((s) => s[0]));
setValidation(leads, `X${LEAD_FIRST}:X${LEAD_LAST}`, leadStatuses);
setValidation(leads, `AF${LEAD_FIRST}:AF${LEAD_LAST}`, lostReasons);

leads.getRange(`V${LEAD_FIRST}:V${LEAD_LAST}`).conditionalFormats.add("containsText", {
  text: "A",
  format: { fill: theme.greenSoft, font: { color: theme.green, bold: true } },
});
leads.getRange(`V${LEAD_FIRST}:V${LEAD_LAST}`).conditionalFormats.add("containsText", {
  text: "B",
  format: { fill: theme.amberSoft, font: { color: theme.amber, bold: true } },
});
leads.getRange(`V${LEAD_FIRST}:V${LEAD_LAST}`).conditionalFormats.add("containsText", {
  text: "C",
  format: { fill: theme.redSoft, font: { color: theme.red, bold: true } },
});
leads.getRange(`AD${LEAD_FIRST}:AD${LEAD_LAST}`).conditionalFormats.add("containsText", {
  text: "是",
  format: { fill: theme.redSoft, font: { color: theme.red, bold: true } },
});

workbook.comments.addThread(
  { cell: leads.getRange("P6") },
  "BANTC 分數採 1-5 分：1 表示條件弱或資訊不足，5 表示非常明確且有利成交。總分權重在 Settings 可調整。"
);

// Follow-up Log
styleTitle(
  log,
  "A1:I1",
  "跟進紀錄",
  "每次聯繫新增一列，主表會依 Lead ID 自動抓最後跟進日。"
);
const logHeaders = [
  "跟進日期",
  "Lead ID",
  "公司名稱",
  "當時階段",
  "接觸方式",
  "跟進摘要",
  "客戶反應",
  "下一步行動",
  "下次跟進日",
  "負責人",
  "結果狀態",
];
log.getRange("A6:K6").values = [logHeaders];
styleHeader(log.getRange("A6:K6"));
const sampleLogs = [
  [date(2026, 1, 16), "L-0001", null, "已聯繫", "Email", "回覆官網表單並確認改版範圍。", "願意安排會議。", "安排需求訪談", date(2026, 1, 20), "User", "已約下一步"],
  [date(2026, 2, 10), "L-0001", null, "成交", "會議", "確認報價與付款條件。", "同意合作。", "寄送合約", date(2026, 2, 15), "User", "已完成"],
  [date(2026, 6, 11), "L-0002", null, "提案/報價", "LINE", "提醒報價有效期限與平台比較。", "表示內部討論中。", "下週追蹤決策", date(2026, 6, 18), "User", "等待回覆"],
  [date(2026, 6, 10), "L-0003", null, "需求訪談", "視訊", "討論商品結構與預購流程。", "預算偏緊但時程急。", "補一版分階段方案", date(2026, 6, 20), "User", "需追蹤"],
  [date(2026, 4, 10), "L-0004", null, "流失", "電話", "確認今年沒有改版預算。", "預算不足。", "明年 Q1 再培育", null, "User", "暫緩"],
  [date(2026, 6, 17), "L-0005", null, "議價/合約", "會議", "討論 ERP 串接與付款節點。", "有意願但需採購確認。", "整理合約條款", date(2026, 6, 24), "User", "已約下一步"],
  [date(2026, 5, 28), "L-0006", null, "已聯繫", "Email", "寄出形象官網案例與初估。", "尚未回覆。", "再次追蹤", date(2026, 6, 12), "User", "需追蹤"],
  [date(2026, 6, 1), "L-0007", null, "成交", "會議", "確認網站架構與作品集內容。", "同意合作。", "啟動專案", null, "User", "已完成"],
  [date(2026, 6, 16), "L-0009", null, "方案/估價", "視訊", "釐清會員匯入與再行銷需求。", "等待 IT 回覆 API。", "確認 API 文件", date(2026, 6, 22), "User", "需追蹤"],
];
log.getRange(`A${LOG_FIRST}:K${LOG_FIRST + sampleLogs.length - 1}`).values = sampleLogs;
log.getRange(`C${LOG_FIRST}`).formulas = [[`=IFERROR(XLOOKUP(B${LOG_FIRST},'Leads'!$A$${LEAD_FIRST}:$A$${LEAD_LAST},'Leads'!$E$${LEAD_FIRST}:$E$${LEAD_LAST},""),"")`]];
log.getRange(`C${LOG_FIRST}:C${LOG_LAST}`).fillDown();
styleTableBody(log.getRange(`A${LOG_FIRST}:K${LOG_LAST}`));
log.tables.add(`A6:K${LOG_LAST}`, true, "FollowupLogTable");
log.freezePanes.freezeRows(6);
log.freezePanes.freezeColumns(3);
log.getRange(`A${LOG_FIRST}:A${LOG_LAST}`).setNumberFormat("yyyy-mm-dd");
log.getRange(`I${LOG_FIRST}:I${LOG_LAST}`).setNumberFormat("yyyy-mm-dd");
log.getRange("A:A").format.columnWidth = 12;
log.getRange("B:C").format.columnWidth = 16;
log.getRange("D:E").format.columnWidth = 16;
log.getRange("F:H").format.columnWidth = 32;
log.getRange("I:K").format.columnWidth = 14;
log.getRange("A1:K306").format.font = { name: "Aptos" };
log.getRange("1:2").format.rowHeight = 24;
log.getRange("6:6").format.rowHeight = 30;
setValidation(log, `B${LOG_FIRST}:B${LOG_LAST}`, sampleLeads.map((x) => x[0]));
setValidation(log, `D${LOG_FIRST}:D${LOG_LAST}`, stages.map((s) => s[0]));
setValidation(log, `E${LOG_FIRST}:E${LOG_LAST}`, contactTypes);
setValidation(log, `K${LOG_FIRST}:K${LOG_LAST}`, outcomeStatuses);

// Dashboard
dash.showGridLines = false;
dash.getRange("A1:I1").merge();
dash.getRange("A1:I1").values = [["BD Lead 分析儀表板"]];
dash.getRange("A1:I1").format = {
  fill: theme.blueDark,
  font: { bold: true, color: "#FFFFFF", size: 18 },
  horizontalAlignment: "left",
  verticalAlignment: "center",
};
dash.getRange("A2:I2").merge();
dash.getRange("A2:I2").values = [["網站開發 / 形象官網 / 電商 / 系統開發潛在客戶追蹤。所有數據來自 Leads 與 Follow-up Log。"]];
dash.getRange("A2:I2").format = {
  fill: theme.blueSoft,
  font: { color: theme.ink, size: 10 },
};

dash.getRange("A4:I7").values = [
  ["總 Lead 數", null, "進行中 Lead", null, "成交數", null, "成交率", null, "逾期跟進"],
  [null, null, null, null, null, null, null, null, null],
  ["高潛力 A 級", null, "Pipeline 金額", null, "平均分數", null, "本月新增", null, "本月成交"],
  [null, null, null, null, null, null, null, null, null],
];
dash.getRange("B5").formulas = [[`=COUNTA('Leads'!$A$${LEAD_FIRST}:$A$${LEAD_LAST})`]];
dash.getRange("D5").formulas = [[`=COUNTIFS('Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"<>成交",'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"<>流失",'Leads'!$A$${LEAD_FIRST}:$A$${LEAD_LAST},"<>")`]];
dash.getRange("F5").formulas = [[`=COUNTIF('Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"成交")`]];
dash.getRange("H5").formulas = [[`=IFERROR(F5/B5,0)`]];
dash.getRange("I5").formulas = [[`=COUNTIF('Leads'!$AD$${LEAD_FIRST}:$AD$${LEAD_LAST},"是")`]];
dash.getRange("B7").formulas = [[`=COUNTIF('Leads'!$V$${LEAD_FIRST}:$V$${LEAD_LAST},"A")`]];
dash.getRange("D7").formulas = [[`=SUMIFS('Leads'!$Z$${LEAD_FIRST}:$Z$${LEAD_LAST},'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"<>成交",'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"<>流失")`]];
dash.getRange("F7").formulas = [[`=IFERROR(AVERAGEIF('Leads'!$U$${LEAD_FIRST}:$U$${LEAD_LAST},">0",'Leads'!$U$${LEAD_FIRST}:$U$${LEAD_LAST}),0)`]];
dash.getRange("H7").formulas = [[`=COUNTIFS('Leads'!$B$${LEAD_FIRST}:$B$${LEAD_LAST},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),'Leads'!$B$${LEAD_FIRST}:$B$${LEAD_LAST},"<"&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1))`]];
dash.getRange("I7").formulas = [[`=COUNTIFS('Leads'!$AE$${LEAD_FIRST}:$AE$${LEAD_LAST},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),'Leads'!$AE$${LEAD_FIRST}:$AE$${LEAD_LAST},"<"&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1),'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"成交")`]];
dash.getRange("A4:I7").format = {
  fill: theme.graySoft,
  borders: { preset: "outside", style: "thin", color: theme.line },
  font: { color: theme.ink },
};
dash.getRange("B5:I7").format = {
  font: { bold: true, color: theme.blueDark, size: 14 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
dash.getRange("H5").format.numberFormat = "0%";
dash.getRange("D7").format.numberFormat = "#,##0";
dash.getRange("F7").format.numberFormat = "0";

dash.getRange("A10:D10").values = [["月份", "新增 Lead", "成交數", "成交率"]];
dash.getRange("A11").formulas = [[`=EDATE(DATE(YEAR(TODAY()),MONTH(TODAY())-11,1),ROW(A1)-1)`]];
dash.getRange("A11:A22").fillDown();
dash.getRange("B11").formulas = [[`=COUNTIFS('Leads'!$B$${LEAD_FIRST}:$B$${LEAD_LAST},">="&A11,'Leads'!$B$${LEAD_FIRST}:$B$${LEAD_LAST},"<"&EDATE(A11,1))`]];
dash.getRange("B11:B22").fillDown();
dash.getRange("C11").formulas = [[`=COUNTIFS('Leads'!$AE$${LEAD_FIRST}:$AE$${LEAD_LAST},">="&A11,'Leads'!$AE$${LEAD_FIRST}:$AE$${LEAD_LAST},"<"&EDATE(A11,1),'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"成交")`]];
dash.getRange("C11:C22").fillDown();
dash.getRange("D11").formulas = [[`=IFERROR(C11/B11,0)`]];
dash.getRange("D11:D22").fillDown();
dash.getRange("R10:T10").values = [["月份", "新增 Lead", "成交數"]];
dash.getRange("R11").formulas = [[`=TEXT(A11,"mmm yyyy")`]];
dash.getRange("R11:R22").fillDown();
dash.getRange("S11:T11").formulas = [[`=B11`, `=C11`]];
dash.getRange("S11:T22").fillDown();
dash.getRange("R10:T22").format.font = { color: "#FFFFFF" };
styleHeader(dash.getRange("A10:D10"));
styleTableBody(dash.getRange("A11:D22"));
dash.getRange("A11:A22").format.numberFormat = "mmm yyyy";
dash.getRange("D11:D22").format.numberFormat = "0%";

dash.getRange("F10:I10").values = [["來源分類", "Lead 數", "成交數", "成交率"]];
dash.getRange("F11:F16").values = sourceCategories.map((x) => [x]);
dash.getRange("G11").formulas = [[`=COUNTIF('Leads'!$C$${LEAD_FIRST}:$C$${LEAD_LAST},F11)`]];
dash.getRange("G11:G16").fillDown();
dash.getRange("H11").formulas = [[`=COUNTIFS('Leads'!$C$${LEAD_FIRST}:$C$${LEAD_LAST},F11,'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},"成交")`]];
dash.getRange("H11:H16").fillDown();
dash.getRange("I11").formulas = [[`=IFERROR(H11/G11,0)`]];
dash.getRange("I11:I16").fillDown();
styleHeader(dash.getRange("F10:I10"));
styleTableBody(dash.getRange("F11:I16"));
dash.getRange("I11:I16").format.numberFormat = "0%";

dash.getRange("A25:D25").values = [["銷售階段", "Lead 數", "預估金額", "加權金額"]];
dash.getRange("A26:A35").values = stages.map((x) => [x[0]]);
dash.getRange("B26").formulas = [[`=COUNTIF('Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},A26)`]];
dash.getRange("B26:B35").fillDown();
dash.getRange("C26").formulas = [[`=SUMIF('Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},A26,'Leads'!$Z$${LEAD_FIRST}:$Z$${LEAD_LAST})`]];
dash.getRange("C26:C35").fillDown();
dash.getRange("D26").formulas = [[`=C26*XLOOKUP(A26,'Settings'!$A$5:$A$14,'Settings'!$B$5:$B$14,0)`]];
dash.getRange("D26:D35").fillDown();
styleHeader(dash.getRange("A25:D25"));
styleTableBody(dash.getRange("A26:D35"));
dash.getRange("C26:D35").format.numberFormat = "#,##0";

dash.getRange("F25:H25").values = [["流失原因", "件數", "占比"]];
dash.getRange("F26:F32").values = lostReasons.map((x) => [x]);
dash.getRange("G26").formulas = [[`=COUNTIF('Leads'!$AF$${LEAD_FIRST}:$AF$${LEAD_LAST},F26)`]];
dash.getRange("G26:G32").fillDown();
dash.getRange("H26").formulas = [[`=IFERROR(G26/SUM($G$26:$G$32),0)`]];
dash.getRange("H26:H32").fillDown();
styleHeader(dash.getRange("F25:H25"));
styleTableBody(dash.getRange("F26:H32"));
dash.getRange("H26:H32").format.numberFormat = "0%";

dash.getRange("J10:M10").values = [["高潛力 Lead", "階段", "預估金額", "下次跟進"]];
dash.getRange("J11").formulas = [[`=IFERROR(INDEX('Leads'!$E$${LEAD_FIRST}:$E$${LEAD_LAST},MATCH(1,('Leads'!$V$${LEAD_FIRST}:$V$${LEAD_LAST}="A")*('Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST}<>"成交")*('Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST}<>"流失"),0)),"")`]];
dash.getRange("K11").formulas = [[`=IF(J11="","",XLOOKUP(J11,'Leads'!$E$${LEAD_FIRST}:$E$${LEAD_LAST},'Leads'!$W$${LEAD_FIRST}:$W$${LEAD_LAST},""))`]];
dash.getRange("L11").formulas = [[`=IF(J11="","",XLOOKUP(J11,'Leads'!$E$${LEAD_FIRST}:$E$${LEAD_LAST},'Leads'!$Z$${LEAD_FIRST}:$Z$${LEAD_LAST},""))`]];
dash.getRange("M11").formulas = [[`=IF(J11="","",XLOOKUP(J11,'Leads'!$E$${LEAD_FIRST}:$E$${LEAD_LAST},'Leads'!$AA$${LEAD_FIRST}:$AA$${LEAD_LAST},""))`]];
styleHeader(dash.getRange("J10:M10"));
styleTableBody(dash.getRange("J11:M14"));
dash.getRange("L11:L14").format.numberFormat = "#,##0";
dash.getRange("M11:M14").format.numberFormat = "yyyy-mm-dd";

const monthlyChart = dash.charts.add("line", dash.getRange("R10:T22"));
monthlyChart.title = "每月新增與成交";
monthlyChart.hasLegend = true;
monthlyChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
monthlyChart.yAxis = { numberFormatCode: "#,##0" };
monthlyChart.setPosition("A38", "I54");

const sourceChart = dash.charts.add("bar", dash.getRange("F10:G16"));
sourceChart.title = "來源 Lead 數";
sourceChart.hasLegend = false;
sourceChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
sourceChart.yAxis = { numberFormatCode: "#,##0" };
sourceChart.setPosition("J15", "Q32");

const stageChart = dash.charts.add("bar", dash.getRange("A25:B35"));
stageChart.title = "銷售階段分布";
stageChart.hasLegend = false;
stageChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
stageChart.yAxis = { numberFormatCode: "#,##0" };
stageChart.setPosition("J34", "Q53");

dash.getRange("A:I").format.columnWidth = 14;
dash.getRange("J:M").format.columnWidth = 16;
dash.getRange("A1:M54").format.font = { name: "Aptos" };
dash.getRange("1:2").format.rowHeight = 26;
dash.getRange("4:7").format.rowHeight = 24;
dash.freezePanes.freezeRows(2);

// Final verification renders.
const dashboardPreview = await workbook.render({
  sheetName: "Dashboard",
  range: "A1:Q54",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/dashboard_preview.png`, new Uint8Array(await dashboardPreview.arrayBuffer()));

const leadsPreview = await workbook.render({
  sheetName: "Leads",
  range: "A1:AI20",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/leads_preview.png`, new Uint8Array(await leadsPreview.arrayBuffer()));

const logPreview = await workbook.render({
  sheetName: "Follow-up Log",
  range: "A1:K20",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/followup_preview.png`, new Uint8Array(await logPreview.arrayBuffer()));

const settingsPreview = await workbook.render({
  sheetName: "Settings",
  range: "A1:K24",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/settings_preview.png`, new Uint8Array(await settingsPreview.arrayBuffer()));

const dashboardInspect = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:M35",
  include: "values,formulas",
  tableMaxRows: 35,
  tableMaxCols: 13,
  maxChars: 8000,
});
console.log(dashboardInspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/bd_lead_analysis_tracker.xlsx`);
console.log(`${outputDir}/bd_lead_analysis_tracker.xlsx`);
