/**
 * ESF 平台身份校验插件（AMXX 1.10）
 *
 * 流程：
 *   1. 启动器拿到后端签发的一次性 token，写进 launcher.cfg 的
 *      setinfo "_platform_token" / "_platform_user"，然后拉起 hl.exe
 *   2. 玩家连入 → 本插件读取 userinfo 里的 token
 *   3. 先做格式白名单（32 位 hex），再异步查库：
 *        launch_tokens.token = ? AND server_key = ? AND used_at IS NULL
 *        AND expires_at > NOW() AND 账号 status='active'
 *   4. 查到 → 消费 token（used_at）、记在线时长、显示欢迎
 *      查不到 → 提示原因并踢人
 *
 * 安全要点：
 *   - token 来自客户端 userinfo，是攻击者完全可控的字符串。
 *     这里必须先用 isValidToken() 卡成 [0-9a-f]{32} 才能拼进 SQL，
 *     否则就是标准的 SQL 注入入口。
 *   - 插件只拿到 v_platform_users 视图（没有 password_hash）。
 */

#include <amxmodx>
#include <sqlx>

#define PLUGIN  "ESF Platform Auth"
#define VERSION "1.1.0"
#define AUTHOR  "ESF Platform"

#define TASK_VERIFY 1000
#define TASK_KICK   2000
#define MAX_PLAYERS_ARRAY 33

new Handle:g_db = Empty_Handle;
new bool:g_dbReady = false;
new bool:g_warnedNoConfig = false;

// 数据库状态：区分"没配置"和"连不上"，前者绝不能容灾放行
enum DbStatus {
    DbReady,
    DbNotConfigured,
    DbUnavailable
}

new g_pcHost, g_pcUser, g_pcPass, g_pcDb;
new g_pcServerKey, g_pcEnforce, g_pcFailOpen, g_pcDebug, g_pcRequireName, g_pcAllowGuest, g_pcSyncName;

new bool:g_authed[MAX_PLAYERS_ARRAY];
new g_userId[MAX_PLAYERS_ARRAY];
new g_tokenId[MAX_PLAYERS_ARRAY];
new g_startedAt[MAX_PLAYERS_ARRAY];
new g_verifyAttempts[MAX_PLAYERS_ARRAY];

public plugin_init() {
    register_plugin(PLUGIN, VERSION, AUTHOR);

    g_pcHost      = register_cvar("platform_sql_host", "");           // 例 127.0.0.1:3307
    g_pcUser      = register_cvar("platform_sql_user", "esf_amxx");
    g_pcPass      = register_cvar("platform_sql_pass", "");
    g_pcDb        = register_cvar("platform_sql_db", "esf_platform");
    g_pcServerKey = register_cvar("platform_server_key", "");         // 必须和数据库 servers.server_key 一致
    g_pcEnforce   = register_cvar("platform_enforce", "1");           // 1=不通过就踢
    g_pcAllowGuest = register_cvar("platform_allow_guest", "0");       // 1=测试期放行非平台玩家（不进平台会话/统计）
    g_pcSyncName  = register_cvar("platform_sync_name", "1");         // 1=进服自动把游戏名改成平台 game_name
    g_pcFailOpen  = register_cvar("platform_fail_open", "1");         // 1=数据库挂了放行，避免锁死服务器
    g_pcDebug     = register_cvar("platform_debug", "0");
    g_pcRequireName = register_cvar("platform_require_name", "0");
}

public plugin_cfg() {
    // amxx.cfg 可能在本回调之后才执行完，直接连库会误报“未配置”。
    // 延迟 5 秒再预热，此时 cvars 一定已经加载。
    set_task(5.0, "taskWarmDatabase");
}

public taskWarmDatabase() {
    ensureDatabase();
}

/**
 * 懒连接 + 状态区分。
 *
 * 为什么要懒连接：AMXX 的 plugin_cfg 可能在 amxx.cfg 之前被调用，
 * 那时 cvar 还是空的。如果把"尚未配置"当成"数据库故障"并 fail_open，
 * 抢先连入的玩家就能绕过校验 —— 这是一个真实存在的绕过口子。
 */
DbStatus:ensureDatabase() {
    if (g_dbReady) return DbReady;

    new host[64], user[32], pass[64], db[32];
    get_pcvar_string(g_pcHost, host, charsmax(host));
    get_pcvar_string(g_pcUser, user, charsmax(user));
    get_pcvar_string(g_pcPass, pass, charsmax(pass));
    get_pcvar_string(g_pcDb, db, charsmax(db));

    if (host[0] == 0) {
        if (!g_warnedNoConfig) {
            log_amx("[Platform] platform_sql_host 未配置，身份校验不可用（在 amxx.cfg 里配置）");
            g_warnedNoConfig = true;
        }
        return DbNotConfigured;
    }

    if (g_db == Empty_Handle) {
        g_db = SQL_MakeDbTuple(host, user, pass, db, 5);
        if (g_db == Empty_Handle) {
            log_amx("[Platform] SQL_MakeDbTuple 失败（参数不合法）");
            return DbUnavailable;
        }
    }

    new errcode = 0, error[128];
    if (!SQL_Connect(g_db, errcode, error, charsmax(error))) {
        log_amx("[Platform] 数据库连接失败 code=%d msg=%s", errcode, error);
        return DbUnavailable;
    }

    // 中文昵称必须 utf8mb4，否则读出来是乱码
    SQL_SetCharset(g_db, "utf8mb4");
    g_dbReady = true;
    log_amx("[Platform] 数据库已连接 (%s)", host);
    return DbReady;
}

// ---------------------------------------------------------------------
// 玩家连入
// ---------------------------------------------------------------------
public client_putinserver(id) {
    g_authed[id] = false;
    g_userId[id] = 0;
    g_tokenId[id] = 0;
    g_startedAt[id] = 0;
    g_verifyAttempts[id] = 0;

    if (is_user_bot(id)) return;

    // 等 userinfo 稳定（连服瞬间可能还没同步完）
    set_task(1.0, "taskVerify", TASK_VERIFY + id);
}

/**
 * 测试期放行非平台玩家。
 *
 * 只做进服放行，不伪造平台身份：
 *   - 不写 g_userId/g_tokenId，不插入 play_sessions；
 *   - 不参与排位/约战识别和战绩回写；
 *   - 默认关闭，必须显式在 amxx.cfg 里设 platform_allow_guest 1。
 */
stock allowGuestEntry(id, const reason[]) {
    new name[32];
    get_user_name(id, name, charsmax(name));
    log_amx("[Platform] guest allowed id=%d user=%s reason=%s", id, name, reason);

    set_hudmessage(255, 210, 80, -1.0, 0.35, 0, 0.0, 5.0, 0.1, 0.2, -1);
    show_hudmessage(id, "测试模式：非平台玩家已放行");
    client_print(id, print_chat, "[平台] 测试模式：%s，本次允许进入（不计平台战绩）", reason);
}

public taskVerify(taskid) {
    new id = taskid - TASK_VERIFY;
    if (!is_user_connected(id)) return;

    new token[40], name[32];
    get_user_info(id, "_platform_token", token, charsmax(token));
    get_user_info(id, "_platform_user", name, charsmax(name));

    if (token[0] == 0) {
        if (get_pcvar_num(g_pcAllowGuest)) {
            allowGuestEntry(id, "未使用平台启动");
            return;
        }
        rejectPlayer(id, "未检测到平台凭证，请从 ESF 平台启动游戏");
        return;
    }

    // 关键：先卡格式，再拼 SQL
    if (!isValidToken(token)) {
        if (get_pcvar_num(g_pcAllowGuest)) {
            allowGuestEntry(id, "平台凭证无效");
            return;
        }
        rejectPlayer(id, "平台凭证格式不正确");
        return;
    }

    // 区分「没配置」和「连不上」：
    //   - 没配置 → 拒绝（否则早进服的人就能绕过校验）
    //   - 连不上 → 按 platform_fail_open 决定是否容灾放行
    new DbStatus:dbStatus = ensureDatabase();
    if (dbStatus == DbNotConfigured) {
        // amxx.cfg 有可能比首个玩家更晚执行（尤其 listen server 房主秒进），
        // 给 5 秒重试窗口，之后仍然没配置才判定为配置错误并拒绝。
        g_verifyAttempts[id]++;
        if (g_verifyAttempts[id] <= 5) {
            set_task(1.0, "taskVerify", TASK_VERIFY + id);
            return;
        }
        log_amx("[Platform] 拒绝 id=%d：平台未配置，不能放行", id);
        rejectPlayer(id, "平台身份校验未配置，请联系管理员");
        return;
    }
    if (dbStatus == DbUnavailable) {
        handlePlatformDown(id, "数据库连接失败");
        return;
    }

    new serverKey[34];
    get_pcvar_string(g_pcServerKey, serverKey, charsmax(serverKey));
    if (serverKey[0] == 0) {
        // 配了数据库却没配服务器标识，同样属于配置错误，不能放行
        log_amx("[Platform] 拒绝 id=%d：platform_server_key 未配置", id);
        rejectPlayer(id, "平台配置不完整，请联系管理员");
        return;
    }

    new query[640];
    formatex(query, charsmax(query),
        "SELECT t.id, u.id, u.game_name, u.role, t.purpose \
           FROM launch_tokens t \
           JOIN v_platform_users u ON u.id = t.user_id \
          WHERE t.token = '%s' AND t.server_key = '%s' \
            AND u.status = 'active' \
            AND ( (t.used_at IS NULL AND t.expires_at > NOW()) \
                  OR t.authorized_until > NOW() ) \
          LIMIT 1",
        token, serverKey);

    if (get_pcvar_num(g_pcDebug)) {
        new prefix[8];
        formatex(prefix, charsmax(prefix), "%.6s", token);
        log_amx("[Platform] 校验中 id=%d user=%s token=%s…", id, name, prefix);
    }

    new data[2];
    data[0] = id;
    data[1] = 0;
    SQL_ThreadQuery(g_db, "OnTokenChecked", query, data, 2);
}

public OnTokenChecked(failstate, Handle:query, error[], errnum, data[], dataSize) {
    new id = data[0];

    if (failstate != TQUERY_SUCCESS) {
        log_amx("[Platform] 查询失败 failstate=%d err=%s", failstate, error);
        handlePlatformDown(id, "平台数据库暂时不可用");
        return;
    }

    if (!is_user_connected(id)) return;

    if (SQL_NumResults(query) == 0) {
        // 测试期放行：旧 token / 过期 token 不让玩家卡在门外，
        // 但同样不写平台会话或战绩。
        if (get_pcvar_num(g_pcAllowGuest)) {
            allowGuestEntry(id, "平台凭证无效或已过期");
            return;
        }
        rejectPlayer(id, "平台凭证无效、已过期或已被使用，请重新从平台启动");
        return;
    }

    new tokenId = SQL_ReadResult(query, 0);
    new userId  = SQL_ReadResult(query, 1);
    new name[32], role[16], purpose[16];
    SQL_ReadResult(query, 2, name, charsmax(name));
    SQL_ReadResult(query, 3, role, charsmax(role));
    SQL_ReadResult(query, 4, purpose, charsmax(purpose));
    // 仅观战者写入该 userinfo；普通进服不额外占用客户端 info string，
    // 否则接近上限时会触发 "Info string length exceeded"。
    if (equal(purpose, "spectate")) {
        set_user_info(id, "_platform_spectator", "1");
    }

    // 进服自动使用平台游戏昵称；平台已限制同名，避免游戏内出现重名玩家。
    if (get_pcvar_num(g_pcSyncName)) {
        set_user_info(id, "name", name);
        log_amx("[Platform] 自动同步游戏昵称 id=%d name=%s", id, name);
    }

    // 可选：强制游戏昵称与平台 game_name 一致（默认关闭，避免彩色名字/改名误伤）
    if (!get_pcvar_num(g_pcSyncName) && get_pcvar_num(g_pcRequireName)) {
        new clientName[32];
        get_user_name(id, clientName, charsmax(clientName));
        if (!equal(clientName, name)) {
            rejectPlayer(id, "游戏昵称必须与平台昵称一致，请改名后重新进入");
            return;
        }
    }

    g_authed[id]    = true;
    g_userId[id]    = userId;
    g_tokenId[id]   = tokenId;
    g_startedAt[id] = get_systime();

    // 消费 token 并开启复用窗口：
    //   used_at        —— 首次使用时间，之后不能再当"未使用"的凭证
    //   authorized_until —— 换图/重连时客户端会重发同一份 userinfo，
    //                       在这个窗口内视为同一会话，不再重复要新 token
    new consume[256];
    formatex(consume, charsmax(consume),
        "UPDATE launch_tokens \
            SET used_at = IFNULL(used_at, NOW()), \
                authorized_until = NOW() + INTERVAL 12 HOUR \
          WHERE id = %d", tokenId);
    SQL_ThreadQuery(g_db, "OnAuxQuery", consume);

    // 记一条在线时长
    new serverKey[34];
    get_pcvar_string(g_pcServerKey, serverKey, charsmax(serverKey));
    new session[256];
    formatex(session, charsmax(session),
        "INSERT INTO play_sessions (user_id, server_key, token_id, started_at) \
         VALUES (%d, '%s', %d, NOW())", userId, serverKey, tokenId);
    SQL_ThreadQuery(g_db, "OnAuxQuery", session);

    log_amx("[Platform] 验证通过 id=%d user=%s role=%s", id, name, role);

    set_hudmessage(0, 255, 128, -1.0, 0.35, 0, 0.0, 5.0, 0.1, 0.2, -1);
    show_hudmessage(id, "平台验证成功^n欢迎你，%s", name);
    client_print(id, print_chat, "[平台] 身份验证成功：%s", name);
}

public OnAuxQuery(failstate, Handle:query, error[], errnum, data[], dataSize) {
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[Platform] 附加写入失败 failstate=%d err=%s", failstate, error);
    }
}

public client_disconnected(id, bool:drop) {
    if (g_userId[id] > 0 && g_db != Empty_Handle) {
        new serverKey[34];
        get_pcvar_string(g_pcServerKey, serverKey, charsmax(serverKey));

        new query[256];
        formatex(query, charsmax(query),
            "UPDATE play_sessions \
                SET ended_at = NOW(), \
                    duration_sec = TIMESTAMPDIFF(SECOND, started_at, NOW()) \
              WHERE user_id = %d AND server_key = '%s' AND ended_at IS NULL \
              ORDER BY id DESC LIMIT 1",
            g_userId[id], serverKey);
        SQL_ThreadQuery(g_db, "OnAuxQuery", query);
    }

    g_authed[id] = false;
    g_userId[id] = 0;
    g_tokenId[id] = 0;
    g_startedAt[id] = 0;
    g_verifyAttempts[id] = 0;

    remove_task(TASK_VERIFY + id);
    remove_task(TASK_KICK + id);
}

// ---------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------
bool:isValidToken(const token[]) {
    if (strlen(token) != 32) return false;

    for (new i = 0; i < 32; i++) {
        new c = token[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

rejectPlayer(id, const reason[]) {
    new name[32], serverKey[34];
    get_user_name(id, name, charsmax(name));
    get_pcvar_string(g_pcServerKey, serverKey, charsmax(serverKey));
    log_amx("[Platform] reject id=%d server=%s name=%s", id, serverKey, name);

    client_print(id, print_chat, "[平台] %s", reason);

    if (get_pcvar_num(g_pcEnforce)) {
        // 延迟一点踢，否则提示还没显示就被断开了
        set_task(1.5, "taskKick", TASK_KICK + id);
    }
}

public taskKick(taskid) {
    new id = taskid - TASK_KICK;
    if (is_user_connected(id)) {
        log_amx("[Platform] 执行踢出 id=%d", id);
        server_cmd("kick #%d", get_user_userid(id));
    }
}

handlePlatformDown(id, const reason[]) {
    #pragma unused reason
    if (get_pcvar_num(g_pcFailOpen)) {
        g_authed[id] = true;
        log_amx("[Platform] 容灾放行 id=%d", id);
        client_print(id, print_chat, "[平台] 验证服务暂时不可用，本次已按容灾策略放行");
    } else {
        rejectPlayer(id, "平台验证服务不可用，请稍后再试");
    }
}
