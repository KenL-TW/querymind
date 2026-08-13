# QueryMind — AWS On-Demand 最低成本 Demo 環境架構說明

> 版本：1.1  
> 日期：2026-06-14  
> 適用階段：Demo / POC / 產品驗證  
> 架構目標：不購買 domain、不建立 RDS、不使用 ALB / ECS / NAT Gateway，以單台 EC2 + EBS 保存資料，並透過「Demo 時才啟動服務」降低成本與攻擊暴露面。

---

## 目錄

1. [架構定位](#1-架構定位)
2. [核心設計原則](#2-核心設計原則)
3. [目標架構總覽](#3-目標架構總覽)
4. [AWS 元件選型](#4-aws-元件選型)
5. [EC2 與 EBS 設計](#5-ec2-與-ebs-設計)
6. [Docker Compose 服務切分](#6-docker-compose-服務切分)
7. [網路與 Security Group 設計](#7-網路與-security-group-設計)
8. [無 Domain 情境下的 URL 與 HTTPS 策略](#8-無-domain-情境下的-url-與-https-策略)
9. [On-Demand 啟停模式](#9-on-demand-啟停模式)
10. [QueryMind 應用設定](#10-querymind-應用設定)
11. [資料庫與檔案保存策略](#11-資料庫與檔案保存策略)
12. [Demo 請求資料流](#12-demo-請求資料流)
13. [成本模型](#13-成本模型)
14. [安全基準](#14-安全基準)
15. [備份與還原策略](#15-備份與還原策略)
16. [維運指令與操作 Runbook](#16-維運指令與操作-runbook)
17. [已知限制](#17-已知限制)
18. [未來升級路線](#18-未來升級路線)
19. [Demo 驗收標準](#19-demo-驗收標準)
20. [建議檔案結構](#20-建議檔案結構)
21. [結論](#21-結論)
22. [參考來源](#22-參考來源)

---

## 1. 架構定位

此文件描述 QueryMind 在 AWS 上的 **On-Demand 最低成本 Demo 架構**。

本版本與一般「公開網站架構」不同，核心不是長時間對外營運，而是：

```text
平常關閉 EC2，保留 EBS 資料
Demo 前啟動 EC2，短時間開放 Web
Demo 後關閉 Web 對外入口，停止 EC2
```

此模式適合：

- 個人產品 Demo
- 客戶短時展示
- POC 驗證
- 低頻率測試
- 不想長時間暴露服務於網際網路
- 不希望為 RDS、ALB、NAT Gateway、Route 53 付出固定成本

此架構不是正式生產環境，也不主打高可用；它的目標是 **用最低成本讓 QueryMind 可以被展示、驗證、除錯與保留資料**。

---

## 2. 核心設計原則

### 2.1 成本最小化

本架構刻意不使用下列 AWS 服務：

| 服務 | Demo 階段不使用原因 |
|---|---|
| Route 53 | 不購買 domain，不需要 Hosted Zone |
| Elastic IP | 不需要固定 IP，避免長期 Public IPv4 成本 |
| RDS PostgreSQL | Demo 階段 DB 放 EC2 的 EBS 即可 |
| ALB | 單機架構以 Nginx reverse proxy 即可 |
| ECS / Fargate | Demo 不需要容器編排平台 |
| NAT Gateway | 固定成本偏高，最低成本架構應避免 |
| WAF | 短時 Demo 可先以 Security Group + Nginx rate limit 控制 |
| CloudFront | 前端靜態檔直接由 Nginx 提供 |
| Secrets Manager | Demo 可先用 `.env`，正式化再導入 |
| S3 | 可選，僅在需要離站備份時使用 |

### 2.2 暴露面最小化

平常狀態：

```text
EC2 stopped
Security Group 不開 80 / 443
不配置 Elastic IP
不開 PostgreSQL port
不開 FastAPI port
```

Demo 時段：

```text
EC2 running
Security Group 短暫開放 80
若可行，80 僅開放給指定 Demo IP
SSH 建議不用 22，改用 AWS Systems Manager Session Manager
```

### 2.3 資料保留

雖然 EC2 可以 Stop，但資料不能消失，因此所有重要資料都放在 EBS：

```text
EBS gp3 volume
├── PostgreSQL data
├── QueryMind metadata
├── Demo business data
├── chat history
├── audit log
├── uploads
├── exports
├── ETL archives
└── pg_dump backups
```

### 2.4 可平滑升級

此架構需保留未來升級能力：

```text
Phase 1: EC2 All-in-One
Phase 2: EC2 App + RDS + S3
Phase 3: CloudFront + S3 Frontend + ALB + ECS + RDS + WAF
```

---

## 3. 目標架構總覽

### 3.1 高階拓撲

```text
Demo User
   │
   │ HTTP 80
   │ Demo time only
   ▼
EC2 Public DNS / Temporary Public IPv4
   │
   ▼
AWS Cloud
└── Default VPC
    └── Public Subnet
        └── EC2 t4g.micro / t4g.small
            │
            ├── Security Group
            │   ├── 80  HTTP：Demo 時段才開
            │   ├── 22  SSH：可選，建議改 SSM
            │   ├── 443 HTTPS：不開，因無 domain
            │   ├── 5432 PostgreSQL：不開
            │   └── 8080 FastAPI：不開
            │
            ├── Docker Compose
            │   ├── nginx
            │   │   ├── Nuxt 3 SPA static files
            │   │   ├── HTTP only
            │   │   ├── Reverse Proxy /v1/* → FastAPI
            │   │   ├── SSE proxy_buffering off
            │   │   ├── Basic Auth，可選但建議
            │   │   └── Rate Limit
            │   │
            │   ├── fastapi
            │   │   ├── QueryMind Backend API
            │   │   ├── /v1/chat SSE streaming
            │   │   ├── Auth / RBAC / Audit
            │   │   ├── LangChain Agent
            │   │   └── Tools Layer
            │   │
            │   └── postgres
            │       ├── QueryMind metadata tables
            │       ├── Demo business tables
            │       ├── Chat history
            │       ├── Session meta
            │       └── Audit log
            │
            └── EBS gp3 Volume
                ├── PostgreSQL data volume
                ├── storage uploads
                ├── exports
                ├── ETL archive
                └── pg_dump backup

External
└── LLM Provider API
    ├── OpenAI
    ├── Anthropic
    └── AWS Bedrock
```

### 3.2 Mermaid 架構圖

```mermaid
flowchart LR
    U[Demo User Browser] -->|HTTP 80<br/>Demo time only| P[EC2 Public DNS<br/>Temporary Public IPv4]

    subgraph AWS[AWS Cloud]
      subgraph VPC[Default VPC / Public Subnet]
        subgraph EC2[EC2 t4g.micro / t4g.small]
          SG[Security Group<br/>80 demo only<br/>22 optional or SSM<br/>443 closed<br/>5432 closed<br/>8080 closed]

          subgraph DC[Docker Compose]
            N[Nginx<br/>Nuxt static<br/>Reverse Proxy /v1<br/>SSE buffering off<br/>Basic Auth<br/>Rate Limit]
            API[FastAPI<br/>QueryMind API<br/>Auth / RBAC<br/>LangChain Agent<br/>Tools Layer]
            PG[PostgreSQL Container<br/>Metadata DB<br/>Demo Business DB<br/>Chat History<br/>Audit Log]
          end

          EBS[(EBS gp3 Volume<br/>PostgreSQL Data<br/>Uploads<br/>Exports<br/>ETL Archives<br/>pg_dump Backups)]
        end
      end
    end

    P --> SG
    SG --> N
    N -->|/v1/*| API
    API --> PG
    PG --> EBS
    API -->|LLM API HTTPS| LLM[OpenAI / Anthropic / Bedrock]
```

---

## 4. AWS 元件選型

### 4.1 必要元件

| 元件 | 建議選型 | 用途 |
|---|---|---|
| EC2 | `t4g.micro` 或 `t4g.small` | 承載 Nginx、FastAPI、PostgreSQL |
| EBS | gp3 20–30GB | 保存 Docker volume、PostgreSQL、檔案、備份 |
| Security Group | 最小開放 | 控制 Demo 對外入口 |
| Public IPv4 | EC2 啟動時自動配置 | Demo 時短暫對外存取 |
| Default VPC | 使用預設 VPC 即可 | 降低網路設計複雜度 |
| IAM Role | EC2 Role | 若使用 SSM 或 S3 備份時需要 |

### 4.2 可選元件

| 元件 | 是否建議 | 用途 |
|---|---:|---|
| S3 | 可選 | 保存 pg_dump、匯出檔、離站備份 |
| Systems Manager Session Manager | 建議 | 管理 EC2，不需要開 SSH |
| CloudWatch Logs | 可選 | 正式化前可以先不用 |
| Snapshot | 可選 | EBS 快照備份 |

### 4.3 明確不使用元件

| 元件 | 不使用原因 |
|---|---|
| Route 53 | 無 domain，不需要 DNS Hosted Zone |
| Elastic IP | 不需要固定 IP，降低 Public IPv4 長期持有成本 |
| RDS | Demo 階段不額外建立 DB 服務 |
| ALB | 單機 Nginx 即可 |
| NAT Gateway | 避免固定成本 |
| ECS / Fargate | Demo 不需要容器平台 |
| WAF | Demo 採短時開放 + Basic Auth + rate limit |
| CloudFront | 單機 Nginx 直接 serving frontend |

---

## 5. EC2 與 EBS 設計

### 5.1 EC2 規格選擇

#### 最低可跑版本

```text
Instance: t4g.micro
vCPU: 2
Memory: 1 GiB
Disk: EBS gp3 20GB
```

適合：

- 個人測試
- 短時間功能確認
- 少量資料
- 低併發 Demo

限制：

- 1 GiB RAM 對 PostgreSQL + FastAPI + LangChain + Nginx 較緊。
- SSE streaming 與 summarizer 同時執行時可能出現記憶體壓力。
- 不適合多人同時操作。

#### 推薦 Demo 版本

```text
Instance: t4g.small
vCPU: 2
Memory: 2 GiB
Disk: EBS gp3 30GB
```

適合：

- 正式產品 Demo
- 客戶展示
- 小型 POC
- 少量多人內測
- QueryMind Agent 流程展示

建議使用 `t4g.small` 作為標準 Demo 規格，除非只是非常短的個人測試。

### 5.2 EBS 設計

EBS 是此架構最重要的資料保存點。

建議掛載：

```text
/mnt/querymind
├── postgres-data/
├── storage/
│   ├── uploads/
│   ├── exports/
│   └── etl_archives/
├── backup/
│   └── dumps/
└── logs/
```

Docker volume 建議綁定到 EBS 路徑：

```yaml
volumes:
  - /mnt/querymind/postgres-data:/var/lib/postgresql/data
  - /mnt/querymind/storage:/app/storage
  - /mnt/querymind/backup:/backup
```

### 5.3 EC2 Stop 後的狀態

```text
EC2 compute：停止計費
EBS volume：持續存在並持續計費
Public IPv4：若非 Elastic IP，通常會釋放
Docker container：停止
PostgreSQL data：保留在 EBS
QueryMind metadata：保留在 EBS
Demo business data：保留在 EBS
```

重點：**Stop EC2 不會刪除 EBS 資料，但 Terminate EC2 可能刪除 root volume，需確認 Delete on termination 設定。**

---

## 6. Docker Compose 服務切分

### 6.1 服務總覽

```text
docker-compose.yml
├── nginx
├── fastapi
└── postgres
```

### 6.2 Nginx

責任：

- 提供 Nuxt 3 build 後的靜態檔案。
- 將 `/v1/*` 反向代理到 FastAPI。
- 對 `/v1/chat` 支援 SSE streaming。
- 加上 Basic Auth，降低被掃描或濫用機率。
- 加上 rate limit，降低惡意請求消耗 LLM API 的風險。
- 不處理正式 HTTPS，因為本架構不購買 domain。

建議設定重點：

```nginx
limit_req_zone $binary_remote_addr zone=querymind_limit:10m rate=5r/s;

server {
    listen 80;
    server_name _;

    # Optional but recommended for demo
    auth_basic "QueryMind Demo";
    auth_basic_user_file /etc/nginx/.htpasswd;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /v1/ {
        limit_req zone=querymind_limit burst=10 nodelay;

        proxy_pass http://fastapi:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE required
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location /health {
        proxy_pass http://fastapi:8080/health;
    }
}
```

### 6.3 FastAPI

責任：

- QueryMind Backend API。
- `/v1/chat` SSE streaming。
- Auth / JWT / Refresh Token。
- RBAC / DLP / Audit。
- LangChain Agent。
- Tools Layer。
- 連接本機 PostgreSQL container。

Demo 階段建議：

```text
Workers: 1
Reason:
- in-process cache 不跨 worker
- APScheduler 單進程較安全
- 記憶體較省
```

建議啟動方式：

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8080
```

### 6.4 PostgreSQL

責任：

- QueryMind metadata。
- Demo business data。
- Chat history。
- Audit log。
- Session meta。
- Schedule records。
- ETL metadata。

建議切分：

```text
PostgreSQL instance
├── querymind_meta
│   ├── qm_users
│   ├── qm_api_keys
│   ├── qm_refresh_tokens
│   ├── qm_invitations
│   ├── qm_chat_messages
│   ├── qm_session_meta
│   ├── qm_audit_log
│   ├── qm_schedule_records
│   ├── qm_code_metadata
│   ├── qm_user_templates
│   ├── qm_saved_insights
│   └── qm_system_config
│
└── querymind_demo
    ├── demo business tables
    ├── sample customers
    ├── sample orders
    ├── sample products
    └── sample analytics tables
```

---

## 7. 網路與 Security Group 設計

### 7.1 平常狀態 Security Group

平常不 Demo 時，建議 inbound 幾乎全關。

```text
Inbound Rules - Normal State
├── 80   closed
├── 443  closed
├── 22   closed，若使用 SSM
├── 5432 closed
└── 8080 closed
```

若仍使用 SSH：

```text
22 SSH from <your-ip>/32 only
```

### 7.2 Demo 時段 Security Group

最安全的 Demo 方式：

```text
Inbound Rules - Demo State
├── 80 HTTP from <demo-user-ip>/32
└── 22 SSH from <your-ip>/32，可選
```

若 Demo 對象 IP 不固定，短時間可使用：

```text
80 HTTP from 0.0.0.0/0
```

但 Demo 後必須移除。

### 7.3 永遠不開放的 Port

| Port | 服務 | 對外開放？ | 原因 |
|---:|---|---:|---|
| 5432 | PostgreSQL | 否 | DB 僅允許 container internal network |
| 8080 | FastAPI | 否 | 僅由 Nginx reverse proxy 存取 |
| 3001 | Nuxt dev server | 否 | Demo 使用 build 後靜態檔 |
| 6379 | Redis | 否 | 本架構不使用 Redis |

### 7.4 建議使用 SSM 取代 SSH

若使用 AWS Systems Manager Session Manager：

```text
Inbound 22 可以完全不開
管理者透過 AWS Console / CLI 進入 EC2
權限由 IAM 控制
不需要管理 SSH key
```

此模式更適合短時 Demo 架構，因為它可以把 EC2 的管理入口也關掉。

---

## 8. 無 Domain 情境下的 URL 與 HTTPS 策略

### 8.1 URL 方式

本架構不購買 domain，因此 Demo URL 使用：

```text
http://<EC2_PUBLIC_IP>
```

或：

```text
http://<EC2_PUBLIC_DNS>
```

例如：

```text
http://ec2-xx-xx-xx-xx.ap-northeast-1.compute.amazonaws.com
```

### 8.2 不使用 Route 53

不需要：

```text
Route 53 Hosted Zone
A Record
CNAME
自有 domain
```

### 8.3 不使用 Elastic IP

Demo 階段不建議配置 Elastic IP。

原因：

- 不需要固定 IP。
- 每次 Demo 前重新取得 Public IP 即可。
- 避免長時間持有 public IPv4 造成額外成本。
- Demo 結束 Stop EC2 後，讓 IP 釋放。

### 8.4 HTTPS 策略

沒有 domain 時，不建議配置正式 HTTPS。

原因：

- Let's Encrypt 需要 domain 驗證。
- 直接對 Public IP 簽發受信任憑證不可行。
- 自簽憑證會讓瀏覽器跳警告，不適合展示。

因此本架構採：

```text
HTTP 80 only
+ Basic Auth
+ QueryMind Login
+ Short Demo Window
+ Security Group Demo-only open
```

注意：

```text
此方式僅適合短時 Demo，不適合正式客戶長期試用。
```

若未來需要正式 HTTPS，應升級為：

```text
自有 domain
+ Route 53 或其他 DNS
+ Nginx Certbot / Let's Encrypt
+ REFRESH_COOKIE_SECURE=true
```

---

## 9. On-Demand 啟停模式

### 9.1 平常狀態

```text
EC2: Stopped
Security Group: 80 closed
Public IP: 不保留固定 IP
EBS: Retained
PostgreSQL data: Retained
LLM API: 無使用
```

此狀態下仍會產生成本：

```text
EBS storage
EBS snapshot，可選
```

但不會產生：

```text
EC2 compute running cost
長時間 public web 暴露風險
長時間 LLM API 被濫用風險
```

### 9.2 Demo 前啟動流程

```text
1. Start EC2
2. 取得新的 Public IPv4 / Public DNS
3. 若使用 SSM，從 Session Manager 進入 EC2
4. 確認 EBS 已掛載到 /mnt/querymind
5. 更新 .env 中 CORS_ORIGINS，如 public IP 有變
6. docker compose up -d
7. Security Group 開放 80
8. 測試 /health
9. 測試登入
10. 測試 /v1/chat SSE
11. 提供 Demo URL 給展示對象
```

### 9.3 Demo 後關閉流程

```text
1. 移除 Security Group 80 inbound rule
2. 可選：docker compose down
3. 可選：執行 pg_dump 備份
4. Stop EC2
5. 檢查 EC2 狀態為 stopped
6. 檢查是否沒有 Elastic IP 被配置
7. 檢查 Billing / Cost Explorer
```

最重要原則：

```text
Demo 後不要只關 Docker。
要 Stop EC2。
```

---

## 10. QueryMind 應用設定

### 10.1 Demo `.env` 基本設定

```env
# Auth
AUTH_ENABLED=true
ANONYMOUS_ROLE=viewer
JWT_SECRET=<replace-with-strong-random-secret>

# No HTTPS / No Domain mode
REFRESH_COOKIE_SECURE=false
CORS_ORIGINS=["http://<EC2_PUBLIC_IP>"]

# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=<your-openai-api-key>
OPENAI_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0

# PostgreSQL local container
METADATA_DB_URL=postgresql+psycopg2://qm_user:qm_pass@postgres:5432/querymind_meta
DB_CONNECTIONS={"default":"postgresql+psycopg2://qm_user:qm_pass@postgres:5432/querymind_demo"}

# Storage on EBS
STORAGE_BACKEND=local
LOCAL_STORAGE_PATH=/app/storage

# Cache
QUERY_CACHE_ENABLED=true
QUERY_CACHE_TTL_SECONDS=120

# Memory
MEMORY_WINDOW_TURNS=10

# Rate Limit
RATE_LIMIT_CHAT=30/minute
RATE_LIMIT_API=120/minute
```

### 10.2 使用 EC2 Public DNS 時

```env
CORS_ORIGINS=["http://ec2-xx-xx-xx-xx.ap-northeast-1.compute.amazonaws.com"]
```

### 10.3 若 Public IP 每次變更

因為不使用 Elastic IP，Public IP 可能在每次 Start EC2 後改變。

需更新：

```text
.env CORS_ORIGINS
frontend runtime config / API base URL
Demo 通知 URL
```

若前端 API 使用相對路徑 `/v1`，則前端不需要重建，只需要 CORS 對應目前 host。

建議前端設定：

```text
API_BASE_URL=/v1
```

由 Nginx reverse proxy 處理後端轉發。

### 10.4 Demo 成本控管設定

建議：

```env
OPENAI_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0
LLM_ROUTING_ENABLED=false
```

若要展示複雜 SQL 分析品質，可在 Demo 前手動切換：

```env
OPENAI_MODEL=gpt-4o
```

Demo 結束後再切回低成本模型。

---

## 11. 資料庫與檔案保存策略

### 11.1 PostgreSQL 不使用 RDS

本架構明確不建立 RDS。

```text
PostgreSQL runs as Docker container on EC2
Data directory mounted to EBS
```

優點：

- 成本最低。
- 架構簡單。
- 易於除錯。
- Demo 資料與 metadata 可保留。

缺點：

- 無 RDS 自動備份。
- EC2 故障會影響 DB。
- 需要自行 pg_dump。
- 不適合正式客戶資料長期保存。

### 11.2 Docker volume 對應

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - /mnt/querymind/postgres-data:/var/lib/postgresql/data
      - /mnt/querymind/backup:/backup
```

### 11.3 Local storage 對應

```yaml
services:
  fastapi:
    volumes:
      - /mnt/querymind/storage:/app/storage
      - /mnt/querymind/backup:/backup
```

### 11.4 pg_dump 檔案保存

```text
/mnt/querymind/backup/dumps/
├── querymind_meta_20260614.sql.gz
├── querymind_demo_20260614.sql.gz
└── ...
```

建議：

```text
保留最近 7 份
重大 Demo 前手動備份
重大資料異動前手動備份
```

---

## 12. Demo 請求資料流

### 12.1 使用者進站

```text
Demo User
   │
   │ http://<EC2_PUBLIC_DNS>
   ▼
Nginx
   │
   ├── Basic Auth，可選
   ├── Serve Nuxt 3 SPA
   └── Browser loads QueryMind UI
```

### 12.2 使用者登入

```text
Browser
   │ POST /v1/auth/login
   ▼
Nginx
   │ reverse proxy
   ▼
FastAPI
   │
   ├── Verify email/password
   ├── Create access token
   ├── Set refresh token cookie
   └── Return user role/capabilities
```

### 12.3 使用者提問

```text
Browser
   │ POST /v1/chat
   │ Authorization: Bearer <access_token>
   │ Accept: text/event-stream
   ▼
Nginx
   │ proxy_buffering off
   ▼
FastAPI
   │
   ├── require_user()
   ├── rate limit
   ├── intent detection
   ├── load session memory
   ├── call LLM provider
   ├── call tools
   ├── execute SQL against local PostgreSQL
   ├── validate result
   ├── generate insights
   └── stream SSE events
```

### 12.4 SSE 回傳

```text
FastAPI
   │
   ├── event: intent
   ├── event: token
   ├── event: thought
   ├── event: observation
   ├── event: finish
   └── event: suggestions
   │
   ▼
Nuxt 3 SPA
   ├── Display streaming answer
   ├── Display Agent steps
   ├── Display warnings
   ├── Display insights
   └── Update follow-up suggestions
```

---

## 13. 成本模型

> 實際費用會依 AWS Region、使用時數、資料傳輸量、EBS 大小、Public IPv4、snapshot、LLM API 使用量而不同。以下為 Demo 階段的估算模型，不作為正式報價。

### 13.1 成本組成

```text
總成本 =
  EC2 running hours
+ Public IPv4 usage hours
+ EBS provisioned storage
+ EBS snapshot，可選
+ Data transfer，可忽略但需留意
+ LLM API usage
```

### 13.2 平常狀態成本

EC2 stopped 時：

```text
EC2 compute: 0
Public IPv4: 若未配置 Elastic IP，通常不持有
EBS: 持續計費
Snapshot: 若建立則持續計費
LLM API: 0
```

因此平常最低成本主要是：

```text
EBS gp3 20–30GB storage
```

### 13.3 Demo 時段成本

Demo 開機後：

```text
EC2 compute: 依 running hours
Public IPv4: 依使用 hours
EBS: 持續計費
LLM API: 依 token 使用量
```

### 13.4 月成本估算方式

假設：

```text
每月 Demo 4 次
每次 3 小時
總 running time = 12 小時 / 月
EBS = 30GB
無 Elastic IP
無 Route 53
無 RDS
無 ALB
無 NAT Gateway
```

估算邏輯：

```text
EC2 cost = instance hourly price * 12
Public IPv4 cost = 0.005 USD * 12
EBS cost = gp3 GB-month price * 30GB
LLM cost = token usage
```

此模式下，雲端固定成本會遠低於 EC2 整月開機模式。

### 13.5 避免隱藏成本清單

| 風險項目 | 避免方式 |
|---|---|
| EC2 忘記關 | Demo 後固定 Stop EC2 |
| Elastic IP 閒置 | 不配置 Elastic IP |
| Security Group 長期開放 | Demo 後移除 80 inbound |
| LLM API 被掃描濫用 | Basic Auth + Login + Rate Limit |
| EBS 越長越大 | 定期清理 exports / logs / old backups |
| Snapshot 累積 | 設定保留數量 |
| CloudWatch Logs 成本 | Demo 階段先用 local logs |

---

## 14. 安全基準

### 14.1 AWS 層安全

必做：

```text
Security Group 80 Demo 時段才開
Security Group 不開 5432
Security Group 不開 8080
不配置 Elastic IP
不使用 root SSH
若使用 SSH，僅允許你的固定 IP
建議使用 SSM Session Manager 取代 SSH
```

### 14.2 Nginx 層安全

建議：

```text
Basic Auth
Rate Limit
proxy_buffering off for SSE
限制 request body size
關閉 server_tokens
```

範例：

```nginx
server_tokens off;
client_max_body_size 10m;
```

### 14.3 QueryMind 應用層安全

必做：

```env
AUTH_ENABLED=true
ANONYMOUS_ROLE=viewer
JWT_SECRET=<strong-random-secret>
```

不要：

```text
不要把 API Key 放前端
不要把 .env commit 到 GitHub
不要使用 default owner key
不要讓 anonymous_role=owner
不要開放 non-SELECT SQL 給 viewer
```

### 14.4 LLM API 成本防護

建議：

```text
Nginx Basic Auth
QueryMind Login
/v1/chat rate limit
每日 Demo token 使用量手動監控
Demo 後關閉 Security Group 80
Demo 後 Stop EC2
```

### 14.5 無 HTTPS 注意事項

因為無 domain，本架構預設 HTTP only。

限制：

```text
不適合長期公開
不適合正式客戶資料
不適合處理敏感個資
不適合讓外部客戶長期自行登入
```

若要長期使用，應升級到 domain + HTTPS。

---

## 15. 備份與還原策略

### 15.1 Local pg_dump

備份指令：

```bash
docker compose exec postgres pg_dump -U qm_user querymind_meta | gzip > /mnt/querymind/backup/dumps/querymind_meta_$(date +%Y%m%d_%H%M%S).sql.gz

docker compose exec postgres pg_dump -U qm_user querymind_demo | gzip > /mnt/querymind/backup/dumps/querymind_demo_$(date +%Y%m%d_%H%M%S).sql.gz
```

### 15.2 備份時機

建議：

```text
每次重要 Demo 前
每次重要 Demo 後
每次大量資料異動前
每次升級程式碼前
```

### 15.3 保留策略

```text
保留最近 7 份 daily dump
保留重大 Demo 版本 dump
刪除過舊 exports
刪除過舊 logs
```

### 15.4 Optional S3 離站備份

若 Demo 資料有保存價值，可加上：

```bash
aws s3 cp /mnt/querymind/backup/dumps/querymind_meta_xxx.sql.gz s3://querymind-demo-backup/postgres/
```

但最低成本版本可以先不使用 S3。

### 15.5 還原流程

```bash
gunzip -c querymind_meta_xxx.sql.gz | docker compose exec -T postgres psql -U qm_user -d querymind_meta

gunzip -c querymind_demo_xxx.sql.gz | docker compose exec -T postgres psql -U qm_user -d querymind_demo
```

---

## 16. 維運指令與操作 Runbook

### 16.1 Demo 前 Runbook

```bash
# 1. Start EC2 from AWS Console or CLI
aws ec2 start-instances --instance-ids <instance-id>

# 2. Connect via SSM or SSH
aws ssm start-session --target <instance-id>

# 3. Check disk
df -h

# 4. Go to deploy directory
cd /opt/querymind-deploy

# 5. Update .env if EC2 Public IP changed
nano .env

# 6. Start services
docker compose up -d

# 7. Check containers
docker compose ps

# 8. Check health
curl http://localhost/health

# 9. Check logs
docker compose logs -f fastapi
```

### 16.2 Demo 後 Runbook

```bash
# 1. Optional backup
./backup/scripts/pg_backup.sh

# 2. Stop containers, optional
docker compose down

# 3. Stop EC2 from AWS Console or CLI
aws ec2 stop-instances --instance-ids <instance-id>
```

同時在 AWS Console：

```text
移除 Security Group 80 inbound rule
確認 EC2 status = stopped
確認沒有 Elastic IP allocation
確認 Billing 沒有異常
```

### 16.3 健康檢查

```bash
curl http://localhost/health
curl http://<EC2_PUBLIC_IP>/health
docker compose ps
docker compose logs --tail=100 fastapi
docker compose logs --tail=100 nginx
docker compose logs --tail=100 postgres
```

### 16.4 資源檢查

```bash
free -m
df -h
docker stats
du -sh /mnt/querymind/*
```

### 16.5 常見問題

#### 問題：前端打 API CORS 錯誤

原因：

```text
EC2 Public IP 改變，但 CORS_ORIGINS 未更新
```

處理：

```text
更新 .env
重啟 fastapi container
```

#### 問題：登入 Cookie 不生效

原因：

```text
HTTP only 模式下 REFRESH_COOKIE_SECURE=true
```

處理：

```env
REFRESH_COOKIE_SECURE=false
```

#### 問題：SSE 沒有逐字流

原因：

```text
Nginx proxy_buffering 未關閉
```

處理：

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 300s;
```

#### 問題：Demo URL 變了

原因：

```text
沒有 Elastic IP，EC2 restart 後 Public IP 可能改變
```

處理：

```text
重新取得 Public DNS / Public IP
更新 Demo 通知
更新 CORS_ORIGINS
```

---

## 17. 已知限制

| 限制 | 說明 | 未來解法 |
|---|---|---|
| 無 domain | URL 不固定，不適合長期展示 | 購買 domain + Route 53 |
| 無 HTTPS | 不適合正式登入與敏感資料 | 加 domain + Let's Encrypt |
| 單機架構 | EC2 掛掉服務中斷 | ALB + ECS / ASG |
| DB 與 App 同機 | EC2 故障會影響 DB | RDS PostgreSQL |
| EBS 單點 | Volume 損毀有風險 | Snapshot / S3 backup |
| 無高可用 | Demo 可接受，正式不可 | Multi-AZ 架構 |
| Public IP 會變 | 每次 Demo URL 可能不同 | Elastic IP 或 domain |
| HTTP Cookie 安全性較弱 | 僅適合短時 Demo | HTTPS |
| ETL 沙箱同機 | 安全隔離不足 | 獨立 container sandbox |
| In-process cache | 多 worker 不共享 | Redis |
| APScheduler 單進程 | 多副本會重複排程 | EventBridge / Celery Beat |

---

## 18. 未來升級路線

### Phase 1：On-Demand 最低成本 Demo

```text
No Domain
No Route 53
No Elastic IP
No RDS
No ALB
No NAT Gateway
EC2 stopped when idle
PostgreSQL on EBS
Nginx + FastAPI + PostgreSQL in Docker Compose
```

目標：

- 最低成本
- 短時 Demo
- 保留資料
- 降低攻擊暴露時間

### Phase 2：穩定 Demo / 內測版

```text
Domain
Route 53 or external DNS
Nginx HTTPS
EC2 always-on or scheduled start/stop
PostgreSQL still local or migrated to RDS
Optional S3 backup
```

升級條件：

- Demo 頻率提高
- URL 需要固定
- 需要正式 HTTPS
- 客戶需要自行登入測試

### Phase 3：正式 POC / 小型正式服務

```text
EC2 App Server
RDS PostgreSQL
S3 Storage
Secrets Manager
CloudWatch Logs
SSM
Domain + HTTPS
```

升級條件：

- 有客戶資料
- 需要可靠備份
- 需要降低 EC2 重建風險
- 需要持續可用

### Phase 4：正式 SaaS 架構

```text
CloudFront + S3 Frontend
ALB
ECS / EC2 Auto Scaling
RDS PostgreSQL Multi-AZ
S3
Secrets Manager
CloudWatch
WAF
Redis
EventBridge / Celery
```

升級條件：

- 多租戶
- 正式收費
- 高可用需求
- 有 SLA
- 有資安稽核

---

## 19. Demo 驗收標準

### 19.1 AWS 與網路

- [ ] EC2 可以正常 Start。
- [ ] EC2 可以正常 Stop。
- [ ] EC2 stopped 後 EBS 資料仍存在。
- [ ] Security Group 平常不開 80。
- [ ] Demo 時段可臨時開啟 80。
- [ ] 5432 未對外開放。
- [ ] 8080 未對外開放。
- [ ] 未配置 Elastic IP。
- [ ] 未建立 Route 53 Hosted Zone。
- [ ] 未建立 RDS。
- [ ] 未建立 ALB。
- [ ] 未建立 NAT Gateway。

### 19.2 應用服務

- [ ] Nginx 可以 serving Nuxt 3 SPA。
- [ ] `/v1/*` 可以 reverse proxy 到 FastAPI。
- [ ] `/v1/chat` SSE streaming 正常。
- [ ] `/health` 正常回應。
- [ ] Nginx Basic Auth 可用，若啟用。
- [ ] Nginx rate limit 可用。

### 19.3 QueryMind 功能

- [ ] 使用者可以登入。
- [ ] Access token 可以呼叫 API。
- [ ] Refresh token 在 HTTP Demo 模式下可運作。
- [ ] `/v1/chat` 可以逐字串流。
- [ ] Agent 可以呼叫 `list_tables`。
- [ ] Agent 可以呼叫 `execute_query`。
- [ ] 查詢結果可以回傳摘要。
- [ ] Chat history 可以寫入 PostgreSQL。
- [ ] Audit log 可以寫入 PostgreSQL。
- [ ] RBAC deny 可以被記錄。

### 19.4 資料保存

- [ ] PostgreSQL data 掛載於 EBS。
- [ ] EC2 Stop/Start 後資料仍存在。
- [ ] uploads / exports / ETL archives 存在 EBS。
- [ ] pg_dump 可以成功產生。
- [ ] pg_dump 可以成功還原。

### 19.5 安全

- [ ] `AUTH_ENABLED=true`。
- [ ] `ANONYMOUS_ROLE=viewer`。
- [ ] `JWT_SECRET` 已替換。
- [ ] `.env` 未 commit。
- [ ] PostgreSQL 密碼不是預設值。
- [ ] Demo 後 Security Group 80 已關閉。
- [ ] Demo 後 EC2 已 stopped。

---

## 20. 建議檔案結構

```text
querymind-deploy/
├── docker-compose.yml
├── .env
├── .env.example
├── nginx/
│   ├── nginx.conf
│   ├── .htpasswd
│   └── conf.d/
│       └── querymind.conf
├── frontend/
│   └── dist/ or .output/public/
├── backend/
│   └── QueryMind FastAPI source
├── postgres/
│   └── init/
│       ├── 001_create_databases.sql
│       ├── 002_init_meta.sql
│       └── 003_init_demo_data.sql
├── storage/
│   ├── uploads/
│   ├── exports/
│   └── etl_archives/
├── backup/
│   ├── scripts/
│   │   └── pg_backup.sh
│   └── dumps/
├── scripts/
│   ├── demo_start_check.sh
│   ├── demo_stop_check.sh
│   └── update_public_origin.sh
└── docs/
    └── querymind_aws_demo_architecture.md
```

---

## 21. 結論

此版本是 QueryMind 目前最符合 Demo 目標的 AWS 架構：

```text
QueryMind On-Demand EC2 Demo Architecture
```

最終建議配置：

```text
EC2 t4g.small，最低可用 t4g.micro
Docker Compose
Nginx
FastAPI
PostgreSQL local container
EBS gp3 for persistent data
No domain
No Route 53
No Elastic IP
No RDS
No ALB
No NAT Gateway
No WAF
No CloudFront
Demo 時段才開 Security Group 80
Demo 後 Stop EC2
```

此架構的核心價值是：

- 成本最低
- 暴露時間最短
- 不需要固定 domain
- 不需要額外 DB 服務
- 資料可透過 EBS 保留
- Demo 啟動快速
- 架構可理解、可維運、可升級

Demo 階段的重點不是雲端元件有多豪華，而是 **QueryMind 問得準、跑得穩、展示順、成本不失控**。

---

## 22. 參考來源

以下為成本與服務行為相關的官方來源，實際費用仍應以 AWS Pricing Calculator 與所選 Region 為準。

1. AWS EC2 On-Demand Pricing  
   https://aws.amazon.com/ec2/pricing/on-demand/

2. AWS Public IPv4 Address Charge  
   https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/

3. Amazon EBS Pricing  
   https://aws.amazon.com/ebs/pricing/

4. AWS Systems Manager Pricing  
   https://aws.amazon.com/systems-manager/pricing/

5. AWS Systems Manager Session Manager Documentation  
   https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html

---

*文件結束。*

