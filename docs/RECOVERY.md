# KeyBox 灾备救援手册（RECOVERY）

> 读者：**零代码基础**的项目所有者。当管理员"登不进去"时，照本文一步步做即可。
> 每个操作都写成 **打开哪里 → 点什么 → 出现什么算成功**，命令都可整行复制。
> 命令里的 `<UID>`（账号编号）、`<新密码>` 等尖括号占位请替换成你自己的值。

---

## ⛔ 先读这一段（红线，务必先懂）

1. **救援只能恢复"账号能登录"。** 能不能**解开**你已存的密钥，取决于你手上的
   **主密码 / 恢复码 / 备份文件**——这三样东西**只在你本地**，**云端永远解不开**（设计如此）。
2. **主密码 + 恢复码 + 备份——三者全丢 = 数据永久救不回。** 没有后门，也没有"工程师帮你解"。
3. 本文的脚本 `scripts/rescue-admin.js` 是**本地手工救援工具**：
   - **只在你自己电脑上手动运行**；**不上传云端、不进云端 CI、不被任何程序自动调用**。
   - **永不读取、永不写入** `payload`（即你的密文内容）。
   - **永不修改** `kdf_salt` / `kdf_salt_prev` / `kdf_verifier` / `key_epoch`
     （覆盖这几个字段会把你的**全部密文变成永远打不开的砖头**）。
   - 凭据只从本机 `.env.local` / 环境变量读取，**不回显、不写日志、不落盘**。
4. **所有会改数据库的操作，都会先打印"将改什么"，并要求你在命令末尾显式追加 `--yes` 才会真正执行。**
   缺 `--yes` 时脚本**只看不改**。

---

## 一、救援能力边界（先对号入座）

| 你能救回什么 | 靠什么 |
|--------------|--------|
| 账号"能登录"（登录密码、状态） | 本文的救援脚本 |
| 密钥"能解密"（拿到明文） | 只有你手上的 **主密码 / 恢复码 / 备份**（在 App 内操作） |

**一句话**：本文帮你把"门"重新打开（能登录）；**门里的保险箱钥匙只有你有**。

---

## 二、场景矩阵（SS1–SS7，先找到你属于哪一类）

| 场景 | 发生了什么 | 能否救 | 用什么手段 | 见 |
|------|------------|:--:|-----------|----|
| **SS1** | 忘了**登录密码**（账号/状态都在） | ✅ | 救援脚本 `reset-login` 重设登录密码 | §SS1 |
| **SS2** | 账号状态被误设成**停用**（disabled） | ✅ | 救援脚本 `set-status` 改回 `active` | §SS2 |
| **SS3** | 账号状态被误设成**已删除**（deleted），但**密文还在** | ✅ | 先确认密文仍在 → `set-status` 改回 `active` | §SS3 |
| **SS4** | **密文已被删除**（`kb_secrets` 里没有该账号数据了） | ❌ | 只能用**本地备份**在 App 内导入 | §SS4 |
| **SS5** | 忘了**主密码**，但**记得恢复码** | ✅ | 在 **App 内**用恢复码重置主密码 | §SS5 |
| **SS6** | **主密码 + 恢复码 + 备份全丢** | ❌ | **永久救不回**（只能重新开始） | §SS6 |
| **SS7** | `kb_users` 里**整行丢失**（账号记录没了） | ✅ | 救援脚本 `recreate-admin` 重建行 | §SS7 |

> ⚠️ **SS2 / SS3 / SS4 的区别**：SS2 是"账号被停用"，SS3 是"账号被软删（数据还在）"，
> SS4 是"数据真的没了"。**先做 §零 的核对**（用 `list-users` 看状态、或查一次密文条数），再决定走哪条。

---

## 零、开始前的准备（一次即可）

### 0.1 确认你在这台电脑上能跑脚本

- **打开哪里**：项目文件夹（含 `package.json` 的那一层，例如 `F:\KeyBox`）。
- **点什么**：在地址栏输入 `cmd` 回车，打开一个黑色命令窗口（终端）。
- **出现什么算成功**：窗口里能执行命令；接着输入下面这行回车：

  ```
  node --version
  ```

  出现 `v20.x` 或更高（例如 `v20.12.0`、`v22.x`）即成功。若提示"不是内部或外部命令"，
  说明没装 Node.js，先去 `https://nodejs.org` 装 **LTS 版**。

### 0.2 准备好"凭据"（脚本读数据库要用）

脚本需要两个值：**环境 ID** 与 **服务端 API Key**。它们放在一个**只在你本机**的
`.env.local` 文件里（**已被 `.gitignore` 挡住，不会进仓库**）。

- **在哪个文件**：项目根目录的 `.env.local`（没有就复制 `.env.example` 改名而来）。
- **点什么**：用记事本打开 `.env.local`，确保有这两行（等号后填你自己的真实值）：

  ```
  TCB_ENV=你的环境ID
  CLOUDBASE_API_KEY=你的服务端APIKey
  ```

  > 这两个值的含义与获取方式见 `docs/CONSOLE-STEPS.md` 附录 A：
  > **环境 ID** 在控制台环境概览页；**服务端 API Key** 在「环境 / API 密钥」里新建（service_role）。
- **出现什么算成功**：下一步 §0.3 能列出用户名单，就说明这两个值填对了。

> 🔒 **千万不要**把这两个值发到群里、贴进截图、或写进任何会提交的文件。它们是**全库钥匙**。

### 0.3 先看一眼"现在有谁"（只读，最安全的第一步）

- **点什么**：在项目根目录终端执行：

  ```
  node scripts/rescue-admin.js list-users
  ```

- **出现什么算成功**：打印出类似下面的名单（**只含 5 列，绝不含任何密钥内容**）：

  ```
  共 2 个用户：
    Ab12...xY  所有者  role=admin   status=active   2026-09-28T03:12:00Z
    Cd34...zW  小李    role=member  status=active   2026-09-28T03:15:00Z
  ```

  第一列就是你的 **UID**（账号编号），**后面所有命令里的 `<UID>` 都从这里复制**。
  若报 `ENV_ID_MISSING` / `SERVICE_CREDENTIAL_MISSING`，回到 §0.2 检查 `.env.local`。

---

## SS1：忘了登录密码（账号还在）✅

**目标**：给某个 uid 重新设一个登录密码，其它一概不动。

1. **先拿到 UID**：见 §0.3（`list-users`）。
2. **执行重设**（把 `<UID>`、`<新登录密码>` 换成你的值；**密码 ≥ 8 位**）：

   ```
   node scripts/rescue-admin.js reset-login --uid <UID> --password <新登录密码>
   ```

   - **出现什么算成功（第一步·预览）**：打印一段"将把 kb_users 中 uid=… 的 login_hash 更新为…"，
     并提示 `❌ 未提供 --yes，已中止`。**这是正常的**——它在等你确认。
3. **确认无误后真正执行**（在末尾补 `--yes`）：

   ```
   node scripts/rescue-admin.js reset-login --uid <UID> --password <新登录密码> --yes
   ```

   - **出现什么算成功**：打印 `✅ 已完成。`
4. **去 App 用新密码登录**：出现登录成功、且能进主界面即完成。

> 说明：脚本**只改 `login_hash` 这一列**。它不碰你的主密码、不碰任何密文。
> 这一步改的是"进门密码"，**与"保险箱（密文）密码"无关**——能否看到密钥仍取决于你的主密码。

---

## SS2：账号被误设成"停用"（disabled）✅

**目标**：把状态改回 `active`。

1. **确认现状**：`node scripts/rescue-admin.js list-users`，找到该 uid，`status=disabled`。
2. **预览**：

   ```
   node scripts/rescue-admin.js set-status --uid <UID> --status active
   ```

3. **执行**（补 `--yes`）：

   ```
   node scripts/rescue-admin.js set-status --uid <UID> --status active --yes
   ```

   - **出现什么算成功**：打印 `✅ 已完成。`；再跑一次 `list-users`，该行 `status=active`。
4. 去 App 登录。

> `--status` 只接受 `active` / `disabled` / `deleted`，写错会报 `INVALID_STATUS`（不会误改）。

---

## SS3：账号被误设成"已删除"（deleted），但数据还在 ✅

> 关键区别：本项目对账号是**软删**（只把 `status` 标成 `deleted`，**不物理删密文**）。
> 若 `kb_secrets` 里该 uid 的密文**还在**，改回 `active` 就能恢复。

1. **先确认密文还在（务必先做这一步）**——见 §六·只读 SQL 的「数该账号还有几条密文」。
   - 若 **n > 0**：密文还在，继续第 2 步。
   - 若 **n = 0**：密文已没了 → **走 §SS4**（本步骤救不了）。
2. **预览改状态**：

   ```
   node scripts/rescue-admin.js set-status --uid <UID> --status active
   ```

3. **执行**：

   ```
   node scripts/rescue-admin.js set-status --uid <UID> --status active --yes
   ```

   - **出现什么算成功**：`✅ 已完成。`；`list-users` 显示 `status=active`；App 登录后能看到既有密钥。

---

## SS4：密文已被删除（数据真的没了）❌

- **现象**：`kb_secrets` 里该账号**没有任何记录**（见 §六 只读 SQL，`n = 0`）。
- **原因**：数据已被删除（例如误执行了"删除该用户数据"，或从未上传过）。
- **能否救**：**救援脚本无能为力**——密文不在云上，任何脚本都变不出来。
- **唯一办法**：如果你**做过本地备份**，用备份恢复：
  1. 打开 App → 进入"备份 / 恢复"入口（备份文件的扩展名以 `KBBK1:` 开头内容标识）。
  2. 选择你**本地的备份文件**导入。
  3. **出现什么算成功**：提示导入成功、密钥列表重新出现。
- 若**没有备份** → 见 §SS6。

---

## SS5：忘了主密码，但记得恢复码 ✅（在 App 内救）

- **这不是登录问题**，救援脚本**不参与**（脚本只恢复"能登录"）。
- **在 App 内操作**：
  1. 登录进 App（若连登录密码也忘了，先做 §SS1）。
  2. 在"解锁 / 输入主密码"处选择 **"用恢复码重置主密码"**。
  3. 输入你**保存的恢复码**（对应内容以 `KBRC1:` 标识），设置一个**新的主密码**。
  4. **出现什么算成功**：提示重置成功，用新主密码能解开既有密钥。
- ⚠️ 恢复码是**一次性救援凭证**，平时就要离线抄写保存好。

---

## SS6：主密码 + 恢复码 + 备份全丢 ❌（永久救不回）

- **事实**：云端**只有密文**，没有任何办法逆推出明文。三者全丢 = **数学上不可恢复**。
- **能做的**：只能"**重新开始**"——用救援脚本恢复**登录能力**（§SS1 / §SS7），
  然后**重新初始化**一套全新的密钥；**旧密文将永远无法解开**（但它仍安静地留在库里）。
- 这一条必须**接受**：没有任何人（包括开发者）能帮你解开。

---

## SS7：`kb_users` 里整行丢失（账号记录没了）✅

> 场景：初始化时用了手输的 uid，之后**那一行被人为删除**，账号记录整个消失。
> `recreate-admin` 会**重建这一行**。

### ⚠️ 先搞懂一件事：uid 必须"对上"

`kb_secrets` 靠 `owner_id` 认人（行级安全是 `owner_id = auth.uid()`）。
**如果你的密文还在，但用了一个全新的 uid 重建账号** → 你能登录，**却一条密钥都看不到**
（数据其实还在库里，只是"认不出"归属）——会被误判成"数据没了"。

所以脚本的 uid 规则是（**默认绝不生成新 uid**）：

1. **你明确给 `--uid <现有uid>`** → 用它。
2. **你没给 uid** → 脚本**自动探测**：从 `kb_secrets` 按 `owner_id` 分组，取**出现次数最多**的那个作候选，
   打印出来（"库中密文归属最集中的 uid 是 X，共 N 条"）并**要你确认**（末尾加 `--yes` 才执行）。
3. **只有你显式加 `--force-new-uid`** 才生成全新 uid，并会**红字警告**：
   "原有 N 条密文对新账号不可读（owner_id 与新 uid 不匹配）"。

### 操作步骤

**先拿到 UID**：优先用 §六 只读 SQL 的「找出密文归属最集中的 uid」；
若你记得原 uid，也可直接用 `--uid <原UID>`。

1. **预览**（下面二选一）：

   ```
   node scripts/rescue-admin.js recreate-admin --uid <原UID> --username <显示名>
   ```

   或（让脚本自动探测候选 uid）：

   ```
   node scripts/rescue-admin.js recreate-admin --username <显示名>
   ```

   - **出现什么算成功（预览）**：打印"将新建（INSERT）kb_users 一行：uid=… role='admin' status='active'…"，
     并提示 `❌ 未提供 --yes，已中止`。**只有传 `--force-new-uid` 时**，预览里才会出现 ⚠️ 红字警告。
2. **确认这是你要的 uid** 后，补 `--yes` 执行：

   ```
   node scripts/rescue-admin.js recreate-admin --uid <原UID> --username <显示名> --yes
   ```

   - **出现什么算成功**：`✅ 已完成。`
3. **紧接着设登录密码**（⚠️ 至此账号仍**无法登录**——占位列是哨兵值 `RESET-REQUIRED`，不是合法哈希。
   **这是有意设计**，必须执行下面这条把登录密码补上）：

   ```
   node scripts/rescue-admin.js reset-login --uid <原UID> --password <新登录密码> --yes
   ```

   - **出现什么算成功**：`✅ 已完成。`。此步之后"登录"这条路才通。
4. **再进 App 重设主密码**：登录后在 App 内设置主密码（会生成真实的 `kdf_salt` / `kdf_verifier`）。
5. **出现什么算成功**：能登录、能看到既有密钥。

> **关于"重建行时脚本写了什么"的现实说明（重要）**：数据库里 `login_hash` / `kdf_salt` /
> `kdf_verifier` 三列都是 **NOT NULL（不允许为空）且没有默认值**（见迁移 `20260927193625`）。
> 因此**新建这一行时**，脚本必须以一个**占位值**写入这三列，否则数据库会直接拒绝插入。
> 脚本用的占位值是一个**哨兵串 `RESET-REQUIRED`**（**不是空串**）：
> - 它**不可能被解析成合法哈希**，因此 → **重建后到"重设主密码"完成前，该账号【无法登录】**
>   （**这是有意设计，不是故障**，见下方步骤 3）。
> - 之所以不用空串：空串万一被某些校验当"无密码"放行，就是一条**静默登录绕过**。
> 脚本**只写哨兵占位，绝不生成/写入任何真实的加密材料**，也**绝不改动既有行**的这些列；
> 真实的 `login_hash` 由步骤 3 的 `reset-login` 写入，真实的 `kdf_salt` / `kdf_verifier`
> 由步骤 4「App 内重设主密码」生成。
> 若该 uid **已存在一行**，脚本会直接报 `USER_ALREADY_EXISTS`，**绝不覆盖**（保护既有密文）。

---

## 六、可复制 SQL（只读核查为主）与"脚本产出的值怎么用"

> 在 **CloudBase 控制台 → 数据库 → SQL 编辑器** 里粘贴执行。
> 下面前 5 条都是**只读**（`select`），可放心跑。**最后两条是写操作**，改前请三思。

**① 列出所有用户（等同 `list-users`）**
```
select uid, username, role, status, created_at from kb_users order by created_at asc;
```

**② 找出被停用/已删除的账号**
```
select uid, username, role, status from kb_users where status <> 'active';
```

**③ 数该账号还有几条密文（SS3 的先决条件）** —— 把 `<UID>` 换成你的 uid
```
select count(*) as n from kb_secrets where owner_id = '<UID>';
```

**④ 找出密文归属最集中的 uid（SS7 自动探测的依据）**
```
select owner_id, count(*) as n from kb_secrets group by owner_id order by n desc;
```

**⑤ 确认某 uid 的账号行是否存在（SS7 前提）**
```
select uid, role, status from kb_users where uid = '<UID>';
```

> **脚本产出的值怎么用**：
> - `list-users` 打印的**第一列**＝ `UID`，就是后续命令 `--uid <UID>` 该填的值。
> - `hash-login-pwd` 打印的整串（形如 `scrypt$16384$8$1$…$…`）＝ `login_hash` 的值。
>   一般**不需要**手动用它——直接跑 `reset-login` 让脚本写库即可；它主要用于**离线核对或手动填库**。
> - `recreate-admin` 预览里打印的 `uid=…` ＝ 即将新建那一行的 uid。

**⑥（写操作）把某账号状态改回 active —— 等同 `set-status`**
```
update kb_users set status = 'active' where uid = '<UID>';
```

**⑦（写操作）手动重建账号行（通常**用脚本更好**；此处仅供理解，不建议手敲）**
```
insert into kb_users (uid, username, role, status, login_hash, kdf_salt, kdf_verifier)
values ('<UID>', '<显示名>', 'admin', 'active', 'RESET-REQUIRED', 'RESET-REQUIRED', 'RESET-REQUIRED');
```
> 注意最后的三个 `'RESET-REQUIRED'`：因三列 NOT NULL，必须给**哨兵占位**（理由同 §SS7）。
> **重建后该账号无法登录**（哨兵不是合法哈希）；必须再执行 `reset-login` 设登录密码 + App 内重设主密码。
> ⚠️ 若该 uid 已有行，这条会因主键冲突失败——**这是好事**（防止覆盖既有账号）。

---

## 七、安全与善后

- 做完救援后，确认 `.env.local` **没有被提交**（它已被 `.gitignore` 挡住）；**不要把 `CLOUDBASE_API_KEY` 外发**。
- 救援脚本**每次只做一件明确的事**，执行前的"预览"就是给你复核的；**看到不对，直接 Ctrl+C / 不加 `--yes` 即可**。
- **预防胜于救援**：请**离线抄写并妥善保存**你的 **主密码 / 恢复码 / 备份文件**——
  它们才是**未来的真正救命绳**；本文脚本只能帮你"回到能用登录的状态"，**换不回丢失的加密材料**。

---

## 附：子命令速查

| 命令 | 作用 | 是否写库 |
|------|------|:--:|
| `node scripts/rescue-admin.js list-users` | 列出用户（uid/username/role/status/created_at） | 否 |
| `node scripts/rescue-admin.js hash-login-pwd --password <密码>` | 打印登录密码哈希（供核对/手填） | 否 |
| `node scripts/rescue-admin.js reset-login --uid <UID> --password <新密码> --yes` | 重设登录密码 | 是 |
| `node scripts/rescue-admin.js set-status --uid <UID> --status <active\|disabled\|deleted> --yes` | 改账号状态 | 是 |
| `node scripts/rescue-admin.js recreate-admin [--uid <UID> \| --force-new-uid] [--username <名>] --yes` | 重建丢失的账号行 | 是 |

> 所有写操作：**先不加 `--yes` 跑一遍看预览，确认无误再补 `--yes` 真正执行。**
