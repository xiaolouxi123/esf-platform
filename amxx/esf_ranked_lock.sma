/**
 * ESF Ranked Lock（AMXX 1.10）
 *
 * 作用：
 *   比赛服务器上，如果数据库里存在 waiting/live 的排位赛，
 *   只允许本场参赛玩家进入，其他玩家延迟 1.5 秒后踢出。
 *
 * 依赖：
 *   - 平台身份插件已把 _platform_token 写进 userinfo
 *   - launch_tokens / ranked_matches / ranked_match_players 表
 *
 * 配置（amxx.cfg）：
 *   ranked_lock "1"
 *   ranked_sql_host "127.0.0.1:3306"
 *   ranked_sql_user "esf_amxx"
 *   ranked_sql_pass "***"
 *   ranked_sql_db "esf_platform"
 *   ranked_server_key "fcx-1v1-1"
 *   ranked_fail_open "1"
 */

#include <amxmodx>
#include <sqlx>

#define PLUGIN  "ESF Ranked Lock"
#define VERSION "1.1.0"
#define AUTHOR  "ESF Platform"

#define TASK_CHECK 3100
#define TASK_KICK  3200
#define MAX_PLAYERS_ARRAY 33

new Handle:g_db = Empty_Handle;
new bool:g_checked[MAX_PLAYERS_ARRAY];

new g_pcHost, g_pcUser, g_pcPass, g_pcDb;
new g_pcServerKey, g_pcLock, g_pcFailOpen;

public plugin_init() {
    register_plugin(PLUGIN, VERSION, AUTHOR);

    g_pcHost      = register_cvar("ranked_sql_host", "");
    g_pcUser      = register_cvar("ranked_sql_user", "esf_amxx");
    g_pcPass      = register_cvar("ranked_sql_pass", "");
    g_pcDb        = register_cvar("ranked_sql_db", "esf_platform");
    g_pcServerKey = register_cvar("ranked_server_key", "");
    g_pcLock      = register_cvar("ranked_lock", "1");
    g_pcFailOpen  = register_cvar("ranked_fail_open", "1");

    set_task(5.0, "taskWarmDatabase");
}

public taskWarmDatabase() {
    ensureDatabase();
}

bool:ensureDatabase() {
    if (g_db != Empty_Handle) return true;

    new host[64], user[32], pass[64], db[32];
    get_pcvar_string(g_pcHost, host, charsmax(host));
    get_pcvar_string(g_pcUser, user, charsmax(user));
    get_pcvar_string(g_pcPass, pass, charsmax(pass));
    get_pcvar_string(g_pcDb, db, charsmax(db));

    if (host[0] == 0) {
        log_amx("[ranked] ranked_sql_host 未配置");
        return false;
    }

    g_db = SQL_MakeDbTuple(host, user, pass, db, 5);
    if (g_db == Empty_Handle) {
        log_amx("[ranked] SQL_MakeDbTuple 失败");
        return false;
    }

    new errcode = 0, error[128];
    if (!SQL_Connect(g_db, errcode, error, charsmax(error))) {
        log_amx("[ranked] 数据库连接失败 code=%d msg=%s", errcode, error);
        SQL_FreeHandle(g_db);
        g_db = Empty_Handle;
        return false;
    }

    SQL_SetCharset(g_db, "utf8mb4");
    log_amx("[ranked] 数据库已连接");
    return true;
}

public client_putinserver(id) {
    g_checked[id] = false;
    if (is_user_bot(id)) return;
    if (!get_pcvar_num(g_pcLock)) return;

    set_task(1.5, "taskCheckPlayer", TASK_CHECK + id);
}

public taskCheckPlayer(taskid) {
    new id = taskid - TASK_CHECK;
    if (!is_user_connected(id) || g_checked[id]) return;
    g_checked[id] = true;

    if (get_pcvar_num(g_pcLock) == 0) return;

    new token[40];
    get_user_info(id, "_platform_token", token, charsmax(token));
    if (!isValidToken(token)) return; // 身份插件负责处理无 token 的情况

    new serverKey[34];
    get_pcvar_string(g_pcServerKey, serverKey, charsmax(serverKey));
    if (serverKey[0] == 0) {
        log_amx("[ranked] ranked_server_key 未配置，跳过");
        return;
    }
    sanitizeKey(serverKey);

    if (!ensureDatabase()) {
        if (get_pcvar_num(g_pcFailOpen)) {
            log_amx("[ranked] 数据库不可用，按容灾放行 id=%d", id);
        } else {
            rejectPlayer(id, "排位赛校验服务不可用，请稍后再试");
        }
        return;
    }

    // 完整 SQL 约 1067 字节；缓冲区过小会截断 FROM launch_tokens t，
    // 导致子查询报 Unknown column 't.user_id'
    new query[1536];
    formatex(query, charsmax(query),
        "SELECT \
           (SELECT COUNT(*) FROM ranked_matches m \
             WHERE m.server_key = '%s' AND m.status IN ('waiting','live')) AS has_match, \
           (SELECT COUNT(*) FROM ranked_matches m \
             JOIN ranked_match_players p ON p.match_id = m.id \
             WHERE m.server_key = '%s' AND m.status IN ('waiting','live') \
               AND p.user_id = t.user_id) AS is_player, \
           (SELECT COUNT(*) FROM challenge_rooms r \
             WHERE r.server_key = '%s' AND r.status = 'live') AS has_challenge, \
           (SELECT COUNT(*) FROM challenge_rooms r \
             JOIN challenge_room_players p ON p.room_id = r.id \
             WHERE r.server_key = '%s' AND r.status = 'live' \
               AND p.user_id = t.user_id) AS is_challenge_player, \
           t.purpose \
         FROM launch_tokens t \
         WHERE t.token = '%s' AND t.server_key = '%s' \
         LIMIT 1",
        serverKey, serverKey, serverKey, serverKey, token, serverKey);

    new data[1];
    data[0] = id;
    SQL_ThreadQuery(g_db, "OnLockChecked", query, data, 1);
}

public OnLockChecked(failstate, Handle:query, error[], errnum, data[], dataSize) {
    new id = data[0];

    if (failstate != TQUERY_SUCCESS) {
        log_amx("[ranked] 查询失败 id=%d err=%s", id, error);
        if (get_pcvar_num(g_pcFailOpen)) {
            log_amx("[ranked] 查询失败，按容灾放行 id=%d", id);
        } else {
            rejectPlayer(id, "排位赛校验服务异常，请稍后再试");
        }
        return;
    }

    if (!is_user_connected(id)) return;
    if (SQL_NumResults(query) == 0) return; // token 无效由身份插件处理

    new hasMatch = SQL_ReadResult(query, 0);
    new isPlayer = SQL_ReadResult(query, 1);
    new hasChallenge = SQL_ReadResult(query, 2);
    new isChallengePlayer = SQL_ReadResult(query, 3);
    new purpose[16];
    SQL_ReadResult(query, 4, purpose, charsmax(purpose));

    if (hasChallenge > 0 && isChallengePlayer == 0) {
        if (equal(purpose, "spectate")) {
            set_user_info(id, "_platform_spectator", "1");
            client_cmd(id, "spectate");
            client_print(id, print_chat, "[约战] 你正在观战本场约战");
            return;
        }
        rejectPlayer(id, "本服务器正在进行约战，只有参赛玩家和观战者可以进入");
        return;
    }

    if (hasMatch > 0 && isPlayer == 0) {
        rejectPlayer(id, "本服务器正在进行排位赛，只有本场参赛玩家可以进入");
    }
}

rejectPlayer(id, const reason[]) {
    new name[32], ip[16];
    get_user_name(id, name, charsmax(name));
    get_user_ip(id, ip, charsmax(ip), 1);
    log_amx("[ranked] rejected id=%d name=%s ip=%s", id, name, ip);
    client_print(id, print_chat, "[排位赛] %s", reason);

    // 本地 listen server 的房主无法被 kick，避免刷错误日志
    if (equal(ip, "127.0.0.1") || equal(ip, "::1")) {
        client_print(id, print_chat, "[排位赛] 本地房主无法被踢出，请从平台进入比赛");
        return;
    }

    set_task(1.0, "taskKick", TASK_KICK + id);
}

public taskKick(taskid) {
    new id = taskid - TASK_KICK;
    if (is_user_connected(id)) {
        server_cmd("kick #%d", get_user_userid(id));
    }
}

bool:isValidToken(const token[]) {
    if (strlen(token) != 32) return false;
    for (new i = 0; i < 32; i++) {
        new c = token[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

sanitizeKey(key[]) {
    for (new i = 0; key[i] != 0; i++) {
        new c = key[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '-' || c == '_')) {
            key[i] = '_';
        }
    }
}
