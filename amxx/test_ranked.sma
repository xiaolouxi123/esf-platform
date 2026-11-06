#include <amxmodx>
#include <amxmisc>
#include <fun>
#include <hlsdk_const>
#include <fakemeta>
#include <engine>
#include <esf>
#include <sqlx>
#include <cromchat>
#include <regex>

/**
 * FCX Battle / ESF Ranked
 * ------------------------------------------------------------------
 * 基于原 test.sma（FCX_BATTLE 0.92，作者 CLOUD）复制修改。
 * 原版战斗、菜单、音乐、击杀限制逻辑保留。
 *
 * 平台增量：
 *   - 1v1 / 2v2 人数自动检测
 *   - 2v2 队伍 HUD、队伍胜负判定
 *   - 平台排位身份识别（token）
 *   - 比赛结果写入 ranked_matches / ranked_profiles
 *   - 比赛结束 5 秒后自动 quit，回到平台
 *
 * 配置：amxx/README.md
 * 原版更新记录：amxx/test_ranked-history.md
 */

#define MAXPL       5000000
#define MAXDEATH    10
#define TASK_SERVER 1032
#define TASK_RANKED 4100
#define TASK_CHALLENGE 4500
#define TASK_CHALLENGE_RETRY 4600
#define CHALLENGE_RETRY_LIMIT 30
#define TASK_CHALLENGE_END 4700
#define TASK_QUIT   4300
#define esf_get_advancedmelee(%1) get_pdata_int(%1, 298)

enum _:PlayerStats {
    bool:PS_IS_REGISTERED,    // 是否已注册
    bool:PS_IS_LOGGED,        // 是否已登录
    bool:PS_IS_CHANGEINFO,    // 是否能修改信息
    PS_TOTAL_KILLS,           // 总击杀
    PS_TOTAL_DEATHS,          // 总死亡
    PS_WINS,                  // 胜场
    PS_LOSES                  // 负场
}

const TASK_ID =1324;
const TASK_LoginCountDown = 64;
const TASK_TIMEREMAIN_LARGE = 34543;

new file[]="addons\amxmodx\configs\SystemInFo.ini";

//new Float:g_fNextY = 0.3;

new g_menu;
new gVoting=0,
    GoodIndex=0,
    EvilIndex=0,
    BattleFlag=0,
    g_SpawnCount=0,
    g_autoTeamSize=0;

new bool:g_iBattle,
    bool:g_BattleState,
    bool:g_iWarrior[33],
    bool:g_bAwaitingPassword[33];

new g_Votes[4],
    g_userCount[33],
    g_powerup[33],
    g_szCachedPassword[33][64], // 临时储存密码.
    g_PlayerStats[33][PlayerStats];

//数据库-正则表达式
new Handle:g_sqlTuple;

// 排位平台库（独立于登录库）
new Handle:g_rankedTuple = Empty_Handle;
new g_rankedMatchId = 0;
new g_rankedKnown = 0;
new g_rankedSeenA = 0;
new g_rankedSeenB = 0;
new g_rankedTeam[33];
new bool:g_rankedSettled = false;

// 约战（challenge）平台模式：独立于排位，不写 ELO
new g_challengeRoomId = 0;
new g_challengeKnown = 0;
new g_challengeTeam[33];
new g_challengeRetry[33];
new g_challengeUserId[33];
new g_challengeBaseKills[33];
new g_challengeBaseDeaths[33];
new g_challengeKills[33];
new g_challengeDeaths[33];
new g_challengeLimit = 10;
new g_challengeVictory[16];
new g_challengeWinner[2];
new g_challengeScoreA = 0;
new g_challengeScoreB = 0;
new g_challengeSettleQuery[320];
new bool:g_challengeActive = false;
new bool:g_challengeSettled = false;
new g_pcRankedHost, g_pcRankedUser, g_pcRankedPass, g_pcRankedDb, g_pcRankedServerKey;
new g_pcQuitEnable, g_pcQuitDelay;
new g_pcPlatformLogin;

// new OrpheuHook:HandleCmd_ArgsHook;

public plugin_precache()
{
   	precache_sound("battleplug/0.wav");
	precache_sound("battleplug/1.wav");
	precache_sound("battleplug/2.wav");
	precache_sound("battleplug/3.wav");
	precache_sound("battleplug/start.wav");
	precache_sound("battleplug/error.wav");
	precache_sound("battleplug/hp.wav");
}

public client_putinserver(id)
{
    g_userCount[id]=0;
    g_rankedTeam[id]=0;
    g_challengeTeam[id]=0;
    g_challengeRetry[id]=0;
    g_challengeUserId[id]=0;
    g_challengeKills[id]=0;
    g_challengeDeaths[id]=0;
    g_challengeBaseKills[id]=get_user_frags(id);
    g_challengeBaseDeaths[id]=get_user_deaths(id);

    //清空菜单
    show_menu( id, 0, "^n", 1 );

    //重置玩家数据函数
    ResetPlayerStats(id);

    //忽略机器人
    if(Is_Bot(id)) return;

    // 平台模式下身份由 esf_platform_auth 负责，跳过旧的 amx 账号库
    if(get_pcvar_num(g_pcPlatformLogin))
    {
        g_PlayerStats[id][PS_IS_REGISTERED] = true;
        g_PlayerStats[id][PS_IS_LOGGED] = true;
        remove_task(id+TASK_LoginCountDown);
    }
    else
    {
        //检查名字注册状态
        CheckPlayerRegistration(id)

        //检查并执行玩家登录函数
        set_task(1.0,"_PlayerLoginCountDown",id+TASK_LoginCountDown,_,_,"b");
    }

    // 2 秒后识别平台排位队伍
    set_task(2.0, "taskRankedIdentify", TASK_RANKED + id);
    set_task(6.0, "taskRankedIdentify", TASK_RANKED + id);
    set_task(12.0, "taskRankedIdentify", TASK_RANKED + id);

    set_task(2.2, "taskChallengeIdentify", TASK_CHALLENGE + id);
    set_task(6.2, "taskChallengeIdentify", TASK_CHALLENGE + id);
    set_task(12.2, "taskChallengeIdentify", TASK_CHALLENGE + id);
    // 约战房间可能在进服 12 秒后才开赛；低频重试最多约 10 分钟，避免漏识别。
    set_task(20.0, "taskChallengeRetry", TASK_CHALLENGE_RETRY + id, _, _, "b");
}

public taskChallengeRetry(taskid)
{
    new id = taskid - TASK_CHALLENGE_RETRY;
    if (!is_user_connected(id)
        || g_challengeTeam[id] != 0
        || g_challengeRetry[id] >= CHALLENGE_RETRY_LIMIT)
    {
        remove_task(taskid);
        return;
    }

    g_challengeRetry[id]++;
    taskChallengeIdentify(TASK_CHALLENGE + id);
}

// 处理玩家修改名字函数
// public client_infochanged(id)
// {
//     if(is_user_connected(id) && g_PlayerStats[id][PS_IS_CHANGEINFO] ) 
//     {
//         g_PlayerStats[id][PS_IS_CHANGEINFO] = false;
//         return PLUGIN_HANDLED;
//     }

//     new name[32],oldname[32];
//     get_user_info(id,"name",name,31);
//     get_user_name(id,oldname,31);

//     if(!equal(name,oldname))
//     {
//         set_user_info(id,"name",oldname);
//         client_print(id,print_chat,"[ Error ] 服务器禁止更改名字!!!");
//         return PLUGIN_HANDLED;
//     } 

//     return PLUGIN_CONTINUE;
// }

public client_disconnected(id)
{
    g_userCount[id]=0;

    if(g_iBattle==true && g_iWarrior[id]==false )
    {
        g_SpawnCount--;
    }

    if(g_iWarrior[id]==true)
    {
        g_iWarrior[id]=false;
    }

    if(g_iBattle)
    {
        // 约战结算必须等异步结果落库；这里不能和排位共用立即 resetAll 的分支。
        new bool:challengeEnded = checkChallengeFinish();
        if(!challengeEnded && checkRankedFinish())
        {
            resetAll();
        }
    }

    if(Is_Bot(id)) return;

    remove_task(id+TASK_LoginCountDown);
    remove_task(id+TASK_ID);
    remove_task(TASK_CHALLENGE_RETRY + id);
    g_challengeRetry[id] = 0;
}

//阻止优化系统发来的消息
public HookSayText(msgId, msgDest, msgEnt)
{
    static szMsg[192];
    get_msg_arg_string(2, szMsg, charsmax(szMsg));

    if(containi(szMsg,"change") != -1 && containi(szMsg,"name") !=  -1)
    {
        //阻止系统发来的改名消息

        for(new i = 1 ; i <= get_maxplayers(); i++)
        {
            if(!is_user_connected(i)) continue;

            if(g_PlayerStats[i][PS_IS_CHANGEINFO])
            {
                client_print(i,print_chat,"* %s 玩家 因未注册/登录被强制更改名字!!!",pev(i,pev_netname));
            }
        }

        return PLUGIN_HANDLED;
    }

    return PLUGIN_CONTINUE;
}
//更改玩家名字函数
public debug_ChangeName(id,_name[])
{
    set_user_info(id,"name",_name);
    // client_cmd(id,"name %s",_name);
}
//初始化数据库内容函数
public SQL_Init()
{
    //从配置文件中读取数据库配置
    new host[16],user[16],pass[16],db[16];

    get_cvar_string("amx_sql_host",host,charsmax(host));
    get_cvar_string("amx_sql_user",user,charsmax(user));
    get_cvar_string("amx_sql_pass",pass,charsmax(pass));
    get_cvar_string("amx_sql_db",db,charsmax(db));

    server_print("host:%s,user:%s,pass:%s,db:%s",host,user,pass,db);

    g_sqlTuple = SQL_MakeDbTuple(host,user,pass,db);

    //执行一次测试查询(异步)
    SQL_ThreadQuery(g_sqlTuple,"onConnectionCheck","SELECT 1");
    
}

//_处理初始化函数
public DelayedSQLInit()
{
    // 平台登录模式下不再连接旧的 amx 账号库，避免 ODBC/root 报错
    if(get_pcvar_num(g_pcPlatformLogin))
    {
        log_amx("[Ranked] platform login mode, legacy account SQL disabled");
        return;
    }

    // 确保sql.cfg已加载
    new configsDir[64];
    get_configsdir(configsDir, charsmax(configsDir));
    
    // 执行sql配置
    server_cmd("exec %s/sql.cfg", configsDir);
    server_exec();
    
    new text[128];
    format(text,charsmax(text),"[ MySql ]exec %s/sql.cfg",configsDir);
    server_print(text);

    // 初始化数据库
    SQL_Init();
}

// ================= 排位平台库 =================
public RankedInit() {
    new host[64], user[32], pass[64], db[32];
    get_pcvar_string(g_pcRankedHost, host, charsmax(host));
    get_pcvar_string(g_pcRankedUser, user, charsmax(user));
    get_pcvar_string(g_pcRankedPass, pass, charsmax(pass));
    get_pcvar_string(g_pcRankedDb, db, charsmax(db));

    if (host[0] == 0) {
        log_amx("[排位] ranked_sql_host 未配置，胜负不会自动回写");
        return;
    }

    g_rankedTuple = SQL_MakeDbTuple(host, user, pass, db, 5);
    if (g_rankedTuple == Empty_Handle) {
        log_amx("[排位] SQL_MakeDbTuple 失败");
        return;
    }

    SQL_ThreadQuery(g_rankedTuple, "OnRankedPing", "SELECT 1");
    log_amx("[排位] 平台库已初始化 (%s)", host);
}

public OnRankedPing(failstate, Handle:query, error[], errnum, data[], dataSize) {
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[排位] 平台库连接失败: %s", error);
    }
    SQL_FreeHandle(query);
}

public taskRankedIdentify(taskid) {
    new id = taskid - TASK_RANKED;
    if (!is_user_connected(id) || g_rankedTuple == Empty_Handle) {
        return;
    }
    if (g_rankedTeam[id] != 0) return;

    new token[40];
    get_user_info(id, "_platform_token", token, charsmax(token));
    if (!isValidRankedToken(token)) return;

    new serverKey[34];
    get_pcvar_string(g_pcRankedServerKey, serverKey, charsmax(serverKey));
    if (serverKey[0] == 0) return;

    new query[640];
    formatex(query, charsmax(query),
        "SELECT m.id, p.team \
           FROM launch_tokens t \
           JOIN ranked_match_players p ON p.user_id = t.user_id \
           JOIN ranked_matches m ON m.id = p.match_id \
          WHERE t.token = '%s' AND t.server_key = '%s' \
            AND m.server_key = '%s' AND m.status IN ('waiting','live') \
          LIMIT 1",
        token, serverKey, serverKey);

    new data[1];
    data[0] = id;
    SQL_ThreadQuery(g_rankedTuple, "OnRankedIdentify", query, data, 1);
}

public OnRankedIdentify(failstate, Handle:query, error[], errnum, data[], dataSize) {
    new id = data[0];
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[排位] 身份查询失败 id=%d err=%s", id, error);
        return;
    }
    if (SQL_NumResults(query) == 0) return;
    if (g_rankedTeam[id] != 0) return;

    new team[2];
    SQL_ReadResult(query, 1, team, 1);
    g_rankedMatchId = SQL_ReadResult(query, 0);
    g_rankedTeam[id] = (team[0] == 'a') ? 1 : 2;
    g_rankedKnown++;
    if (g_rankedTeam[id] == 1) g_rankedSeenA++;
    else g_rankedSeenB++;

    client_print(id, print_chat, "[排位] 已识别为 %s 队，比赛结果将自动回写平台",
        g_rankedTeam[id] == 1 ? "A" : "B");
}

bool:isValidRankedToken(const token[]) {
    if (strlen(token) != 32) return false;
    for (new i = 0; i < 32; i++) {
        new c = token[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

// ================= 约战：平台房间、锁服与结果回写 =================
public taskChallengeIdentify(taskid) {
    new id = taskid - TASK_CHALLENGE;
    if (!is_user_connected(id) || g_rankedTuple == Empty_Handle) return;
    if (g_challengeTeam[id] != 0 && !g_challengeSettled) return;

    new token[40];
    get_user_info(id, "_platform_token", token, charsmax(token));
    if (!isValidRankedToken(token)) return;

    new serverKey[34];
    get_pcvar_string(g_pcRankedServerKey, serverKey, charsmax(serverKey));
    if (serverKey[0] == 0) return;

    new query[720];
    formatex(query, charsmax(query),
        "SELECT r.id, p.team, COALESCE(c.victory_type, 'kills'), COALESCE(c.victory_limit, 10), t.user_id \
           FROM launch_tokens t \
           JOIN challenge_room_players p ON p.user_id = t.user_id \
           JOIN challenge_rooms r ON r.id = p.room_id \
           LEFT JOIN challenge_configs c ON c.room_id = r.id \
          WHERE t.token = '%s' AND t.server_key = '%s' \
            AND t.purpose = 'join' AND r.status = 'live' AND r.server_key = '%s' \
          LIMIT 1",
        token, serverKey, serverKey);

    new data[1];
    data[0] = id;
    SQL_ThreadQuery(g_rankedTuple, "OnChallengeIdentify", query, data, 1);
}

public OnChallengeIdentify(failstate, Handle:query, error[], errnum, data[], dataSize) {
    new id = data[0];
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[约战] 身份查询失败 id=%d err=%s", id, error);
        return;
    }
    if (SQL_NumResults(query) == 0 || (g_challengeTeam[id] != 0 && !g_challengeSettled)) return;

    new roomId = SQL_ReadResult(query, 0);
    if (roomId <= 0) return;

    if (g_challengeRoomId != roomId) {
        g_challengeRoomId = roomId;
        g_challengeKnown = 0;
        g_challengeSettled = false;
        g_challengeActive = true;
        for (new i = 1; i <= get_maxplayers(); i++) {
            g_challengeTeam[i] = 0;
            g_challengeUserId[i] = 0;
            g_challengeKills[i] = 0;
            g_challengeDeaths[i] = 0;
        }
    }

    new team[2];
    SQL_ReadResult(query, 1, team, 1);
    new type[16];
    SQL_ReadResult(query, 2, type, charsmax(type));
    new limit = SQL_ReadResult(query, 3);
    g_challengeUserId[id] = SQL_ReadResult(query, 4);

    g_challengeTeam[id] = (team[0] == 'a') ? 1 : 2;
    g_challengeKills[id] = 0;
    g_challengeDeaths[id] = 0;
    g_challengeBaseKills[id] = get_user_frags(id);
    g_challengeBaseDeaths[id] = get_user_deaths(id);
    g_challengeKnown++;
    copy(g_challengeVictory, charsmax(g_challengeVictory), type);
    g_challengeLimit = (limit >= 3 && limit <= 50) ? limit : 10;

    client_print(id, print_chat,
        "[约战] 已进入平台房间 #%d，%s队；胜利条件：%s %d 次，结束后自动回平台",
        g_challengeRoomId, g_challengeTeam[id] == 1 ? "A" : "B",
        equal(g_challengeVictory, "deaths") ? "死亡" : "击杀", g_challengeLimit);
}

/** 约战结算：按击杀/死亡阈值判定，写个人统计并调用平台存储过程 */
bool:checkChallengeFinish() {
    if (!g_iBattle || !g_challengeActive || g_challengeRoomId == 0 ||
        g_challengeSettled || g_rankedTuple == Empty_Handle) {
        return false;
    }

    // 1v1 只要识别到任意一名参赛者即可结算；2v2 至少识别到一支完整队伍（2 人）。
    // 不能要求房间内所有人都识别成功，否则某个 token 失效时比赛永远不会结算。
    new need = (g_autoTeamSize > 1) ? g_autoTeamSize : 1;
    if (g_challengeKnown < need) return false;

    new scoreA = 0, scoreB = 0;
    for (new i = 1; i <= get_maxplayers(); i++) {
        if (!is_user_connected(i) || g_challengeTeam[i] == 0) continue;
        new kills = g_challengeKills[i];
        new deaths = g_challengeDeaths[i];
        new amount = equal(g_challengeVictory, "deaths") ? deaths : kills;
        if (g_challengeTeam[i] == 1) {
            scoreA += amount;
        } else {
            scoreB += amount;
        }
    }

    new bool:reached = false;
    new winner[2];
    winner[0] = 0;

    if (equal(g_challengeVictory, "deaths")) {
        if (scoreA >= g_challengeLimit || scoreB >= g_challengeLimit) {
            reached = true;
            copy(winner, charsmax(winner), scoreA < scoreB ? "a" : "b");
        }
    } else {
        if (scoreA >= g_challengeLimit || scoreB >= g_challengeLimit) {
            reached = true;
            copy(winner, charsmax(winner), scoreA > scoreB ? "a" : "b");
        }
    }
    if (!reached) return false;

    g_challengeSettled = true;
    copy(g_challengeWinner, charsmax(g_challengeWinner), winner);
    g_challengeScoreA = scoreA;
    g_challengeScoreB = scoreB;
    formatex(g_challengeSettleQuery, charsmax(g_challengeSettleQuery),
        "CALL settle_challenge_match(%d, '%s', %d, %d, '%s', %d)",
        g_challengeRoomId, g_challengeWinner, g_challengeScoreA, g_challengeScoreB,
        g_challengeVictory, g_challengeLimit);

    new stats[768];
    new len = 0, count = 0;
    stats[0] = 0;
    new teamChar[2];
    for (new i = 1; i <= get_maxplayers(); i++) {
        if (!is_user_connected(i) || g_challengeTeam[i] == 0) continue;
        new kills = g_challengeKills[i];
        new deaths = g_challengeDeaths[i];
        teamChar[0] = (g_challengeTeam[i] == 1) ? 'a' : 'b';
        teamChar[1] = 0;
        if (count > 0) {
            stats[len++] = ',';
            stats[len] = 0;
        }
        len += formatex(stats[len], charsmax(stats) - len, "(%d,%d,'%s',%d,%d)",
            g_challengeRoomId, g_challengeUserId[i], teamChar, kills, deaths);
        count++;
    }

    if (count > 0) {
        new query[1100];
        formatex(query, charsmax(query),
            "INSERT INTO challenge_player_stats (room_id,user_id,team,kills,deaths) VALUES %s \
             ON DUPLICATE KEY UPDATE team=VALUES(team), kills=VALUES(kills), deaths=VALUES(deaths)",
            stats);
        SQL_ThreadQuery(g_rankedTuple, "OnChallengeStatsSaved", query);
    } else {
        settleChallengeResult();
    }

    log_amx("[约战] room=%d finished, winner=%s, score=%d:%d, rule=%s %d",
        g_challengeRoomId, g_challengeWinner, g_challengeScoreA, g_challengeScoreB,
        g_challengeVictory, g_challengeLimit);
    client_print(0, print_chat, "[约战] 比赛结束，%s队获胜 %d:%d，正在上传战绩...",
        g_challengeWinner[0] == 'a' ? "A" : "B", g_challengeScoreA, g_challengeScoreB);

    // 数据库/存储过程异常时兜底结束，避免玩家永远卡在“正在上传战绩”。
    set_task(12.0, "taskForceChallengeEnd", TASK_CHALLENGE_END);
    return true;
}

public taskForceChallengeEnd()
{
    if (!g_iBattle || !g_challengeSettled) return;
    log_amx("[约战] 结算等待超时，强制结束 room=%d", g_challengeRoomId);
    client_print(0, print_chat, "[约战] 结算超时，已结束本场比赛。");
    resetAll();
}

public OnChallengeStatsSaved(failstate, Handle:query, error[], errnum, data[], dataSize) {
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[约战] 个人战绩写入失败: %s", error);
    }
    SQL_FreeHandle(query);
    settleChallengeResult();
}

settleChallengeResult() {
    if (g_challengeSettleQuery[0] == 0 || g_rankedTuple == Empty_Handle) return;
    SQL_ThreadQuery(g_rankedTuple, "OnChallengeSettled", g_challengeSettleQuery);
}

public OnChallengeSettled(failstate, Handle:query, error[], errnum, data[], dataSize) {
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[约战] 结果写入失败: %s", error);
    } else {
        log_amx("[约战] 结果写入成功 room=%d", g_challengeRoomId);
    }
    SQL_FreeHandle(query);

    // 结果落库后再结束/退出，给平台留出读取 lastResult 的时间。
    remove_task(TASK_CHALLENGE_END);
    resetAll();
}

/** 一方平台队员全部出局时，自动结算 */
bool:checkRankedFinish() {
    if (g_challengeActive) return false;
    if (!g_iBattle || g_rankedMatchId == 0 || g_rankedSettled || g_rankedTuple == Empty_Handle) {
        return false;
    }

    new need = (g_autoTeamSize > 0) ? g_autoTeamSize * 2 : 2;
    if (g_rankedKnown < need || g_rankedSeenA == 0 || g_rankedSeenB == 0) return false;

    new aliveA = 0, aliveB = 0;
    for (new i = 1; i <= get_maxplayers(); i++) {
        if (!is_user_connected(i) || g_iWarrior[i]) continue;
        if (g_rankedTeam[i] == 1) aliveA++;
        else if (g_rankedTeam[i] == 2) aliveB++;
    }

    if (aliveA > 0 && aliveB > 0) return false;

    new winner[2];
    formatex(winner, charsmax(winner), "%s", (aliveA > 0) ? "a" : "b");
    new query[128];
    formatex(query, charsmax(query), "CALL settle_ranked_match(%d, '%s')", g_rankedMatchId, winner);
    SQL_ThreadQuery(g_rankedTuple, "OnRankedSettled", query);
    log_amx("[Ranked] match %d settled, winner=%s", g_rankedMatchId, winner);
    client_print(0, print_chat, "[Ranked] match finished, winner=%s, saving platform stats...", winner);

    g_rankedSettled = true;
    g_rankedMatchId = 0;
    return true;
}

public OnRankedSettled(failstate, Handle:query, error[], errnum, data[], dataSize) {
    if (failstate != TQUERY_SUCCESS) {
        log_amx("[排位] 结算写入失败: %s", error);
    } else {
        log_amx("[排位] 结算写入成功");
    }
    SQL_FreeHandle(query);
}

//检测玩家名字注册状态函数,添加sql查询语句
public CheckPlayerRegistration(id)
{
    //功能实现:检查玩家在数据库中的注册状态,并根据结果执行相应操作

    //根据数据库中存储的名字查询玩家是否已经注册

    new name[32];
    get_user_name(id,name,31);

    SQL_QuoteString(Empty_Handle, name, charsmax(name), name);

    //构建查询语句 tb_user中结构体Acc_name
    new query[256];
    // format(query,charsmax(query),"SELECT * FROM `tb_user` WHERE `Acc_name` = '%s'",name);
    format(query, charsmax(query), "SELECT `Acc_ip` FROM `tb_user` WHERE `Acc_name` = '%s'", name);

    //存储id和name
    new data[65];
    data[0] = id;
    copy(data[1],64,name);

    server_print("[ Debug ] 查询玩家名字:%s",name);
    server_print("[ Debug ] 查询玩家名字:%s",data);

    //执行异步查询,并指定回调函数onPlayerRegistrationCheck进行处理结果
    SQL_ThreadQuery(g_sqlTuple,"onPlayerRegistrationCheck",query,data,sizeof(data));
}

//回调处理玩家注册函数
public onPlayerRegistrationCheck(FailState,Handle:query,error[],errNum,data[],dataSize)
{
    //接收数据
    new id = data[0];

    static time[64],name[64];
    copy(name,64,data[1]);

    get_time("%m/%d/%Y - %H:%M:%S",time,63);

    // 获取玩家当前IP
    new current_ip[16];
    get_user_ip(id, current_ip, 15, 1); //不包含端口号

    // 检查数据库是否正常运行/未连接/查询失败
    if(FailState != TQUERY_SUCCESS)
    {
        server_print("[ MySql ] 查询失败:%s 错误码(%d)",error,errNum);
        log_amx("时间:%s -- 插件[ fcx_battle.amxx] -> [ MySql ] 查询失败:%s 错误码(%d)",time,error,errNum);
    }

    //检查函数传来的query命令中的数据是否存在 -> 已经存在的情况
    if(SQL_NumResults(query) > 0 )
    {
        //添加自动登录功能,查找验证,凭证数据库ip地址对比(无需密码)
        new db_ip[16];
        SQL_ReadResult(query, 0, db_ip, 15); // 读取 Acc_ip 字段

        if(equal(current_ip, db_ip))
        {
            // IP 地址匹配，自动登录成功
            g_PlayerStats[id][PS_IS_REGISTERED] = true;
            g_PlayerStats[id][PS_IS_LOGGED] = true;

            client_print(id, print_chat, "[系统] 玩家%s ,自动登录成功(Ip验证通过)",name);
            server_print("[ MySql ] 玩家 %s 自动登录成功(Ip验证通过)", name);

        }
        else
        {
            // IP 地址不匹配，自动登录失败,为防止名字重复,修改玩家的名字
            g_PlayerStats[id][PS_IS_REGISTERED] = true;
            g_PlayerStats[id][PS_IS_CHANGEINFO] = true;

            // debug_ChangeName(id,"Un-Login");

            client_print(0, print_chat, "[ MySql ] 该名称'%s'已经注册过,请登录账号!!!忘记账号密码请联系管理员!", name);
            server_print("[ MySql ] 玩家 %s 尝试使用已注册的名字登录", name);
        }
    }
    else
    {
        //强制玩家注册账号,弹出注册界面{账号,密码,确认密码} 账号即是游戏名字唯一性
        // 如果名字不存在，插入添加新玩家数据语句 tb_user结构体{Acc_id,Acc_name,Acc_password}
        g_PlayerStats[id][PS_IS_REGISTERED] = false;
        g_PlayerStats[id][PS_IS_CHANGEINFO] = true;

        // debug_ChangeName(id,"Un-Enroll");

        client_print(0, print_chat, "[ MySql ] 该名称'%s'尚未注册,请注册账号!!!", name);
        server_print("[ MySql ] 玩家 %s 的名字尚未注册", name);
    }

    SQL_FreeHandle(query);

    return PLUGIN_CONTINUE;
}

// 异步插入名字到数据库后的回调结果函数      
public HandleInsertNewPlayerData(FailState, Handle:query, error[], errNum, data[], dataSize)
{
    if (!data[0])
        return;
        
    new Client = data[0];
    if (!is_user_connected(Client))
        return;
        
    static name[64];
    copy(name, 64, data[1]);
    
    static time[64];
    get_time("%m/%d/%Y - %H:%M:%S", time, 63);
    
    if (FailState != TQUERY_SUCCESS)
    {
        log_amx("时间:%s -- [ MySql ] 异常 - 插入数据失败:%s 错误码(%d)", time, error, errNum);
        client_print(Client, print_chat, "[ MySql ] 数据保存失败，%s请联系管理员!",name);
        return;
    }
    
    client_print(0, print_chat, "[ MySql ] 账号'%s'已成功注册!", name);
    server_print("[ MySql ] 新玩家 %s 数据保存成功", name);

    g_PlayerStats[Client][PS_IS_REGISTERED] = true;
    g_PlayerStats[Client][PS_IS_LOGGED] = true;

    SQL_FreeHandle(query);
}



// 服务器验证数据库连接状态函数
public onConnectionCheck(FailState,Handle:query,error[],errNum,data[],dataSize)
{
    static time[64];

    get_time("%m/%d/%Y - %H:%M:%S",time,63);

    //错误状态查询
    switch(FailState) 
    {
        case TQUERY_SUCCESS:
        {
            //成功接收到结果(即使查询无实际数据也说明连接正常)
            server_print("[ MySql ] 连接状态 : 成功连接到数据库!");
            log_amx("时间:%s -- 插件[fcxbattle.amxx] -> [ MySql ] 连接状态 : 成功连接到数据库!",time);

            //可选:验证数据结果有效性(确保查询执行成功)
            if(SQL_NumResults(query)>0)
            {
                server_print("[ MySql ] 测试查询验证通过");
                log_amx("时间:%s -- 插件[fcxbattle.amxx] -> [ MySql ] 测试查询验证通过!",time);
            }
        }
        case TQUERY_CONNECT_FAILED:
        {
            server_print("[ MySql ] 连接失败:%s 错误码(%d)",error,errNum);
            log_amx("时间:%s -- 插件[fcxbattle.amxx] -> [ MySql ] 连接失败:%s 错误码(%d)",time,error,errNum);
        }
        case TQUERY_QUERY_FAILED:
        {
            server_print("[ MySql ] 查询失败:%s 错误码(%d)",error,errNum);
            log_amx("时间:%s -- 插件[fcxbattle.amxx] -> [ My Sql ] 查询失败:%s 错误码(%d)",time,error,errNum);
        }
    }

    //释放内存
    SQL_FreeHandle(query);
}

public onPlayerHookSay(id,msg[],len,flag)
{

}

//彩色打印玩家IO内容
/* public hook_say(id)
{
    new name[32],szMsg[128],szNmsg[128];
    read_argv(1,szMsg,sizeof(szMsg));
    
    new Random_RGB[3];
    Random_RGB[0]=random_num(50,255);
    Random_RGB[1]=random_num(50,255);
    Random_RGB[2]=random_num(50,255);
    
    pev(id,pev_netname,name,31);
    
    format(szNmsg,127,"*DEAD* %s : %s",name,szMsg);

    CC_SendMessage(id,"%s",szMsg);
    
    if(!is_user_alive(id))
	{
        g_fNextY += 0.025;
        set_hudmessage( Random_RGB[0],Random_RGB[1],Random_RGB[2], 0.05, g_fNextY, 0, 0.0, 5.0, 0.0, 1.5, 110 );
        show_dhudmessage( 0, szNmsg);
        
        if(g_fNextY>=0.7)
			g_fNextY=0.3;
            
        return PLUGIN_HANDLED;
	}
    
    return PLUGIN_CONTINUE;
}
*/

/*
public blockCommand(id)
{
    if(!is_user_alive(id) || !is_user_connected(id))return FMRES_HANDLED;

    static sz_agv[20];
    read_argv(0,sz_agv,sizeof(sz_agv));

    // static szags[20];
    // read_argv(0,szags,sizeof(szags));

    // client_print(id,print_chat,"name:%s",szags);

    if(equal(sz_agv,"spectate")&& g_iBattle==true && g_iWarrior[id]==false )
    {
        new szMsg[50]="[Battle Start] You Cant Be Spectator"
        
        Message(id,{2550,0,0},szMsg,3.0);

        PlaySound(id,"battleplug/error.wav");

        return FMRES_SUPERCEDE;
    }

    // client_print(id,print_chat,"%s ",sz_agv);
    return FMRES_IGNORED;
}*/

public client_command(id)
{
    //忽略机器人
    if(Is_Bot(id)) return PLUGIN_CONTINUE;

    static sz_agv[20] , szMsg[64];

    read_argv(0,sz_agv,sizeof(sz_agv));

    if(g_PlayerStats[id][PS_IS_LOGGED] == false)
    {
        if(equal(sz_agv,"change_class"))
        {
            szMsg = "[ Server ] Only Login Player Use!";

            Message(id,{200,50,100},szMsg,3.0);

            PlaySound(id,"battleplug/error.wav");

            return PLUGIN_HANDLED;
        }
        else if(equal(sz_agv,"change_team")) 
        {
            szMsg = "[ Server ] Only Login Player Use!";

            Message(id,{200,50,100},szMsg,3.0);

            PlaySound(id,"battleplug/error.wav");

            return PLUGIN_HANDLED;            
        }
    }

    if(equal(sz_agv,"change_class") && g_iBattle==true && g_iWarrior[id]==false )
    {
        szMsg = "[ Battle Start ]You Cant't Class Change!";

        Message(id,{255,130,71},szMsg,3.0);

        PlaySound(id,"battleplug/error.wav");

        return PLUGIN_HANDLED_MAIN;
    }
    else if(equal(sz_agv,"spectate") && g_iBattle == true && g_iWarrior[id]== false )
    {
        szMsg = "[ Battle Start] You Cant Be Spectator"
        
        Message(id,{255,0,0},szMsg,3.0);

        PlaySound(id,"battleplug/error.wav");

        return PLUGIN_HANDLED_MAIN;
    }
    else if(equal(sz_agv,"change_team") && g_iBattle == true && g_iWarrior[id] == true)
    {
        szMsg = "[ Battle Start ] You Can't Joint The Current Game "
        
        Message(id,{255,255,255},szMsg,3.0);

        PlaySound(id,"battleplug/error.wav");

        return PLUGIN_HANDLED_MAIN;
    }

    return PLUGIN_CONTINUE;
}

public hookcmd(id)
{
    new szMsg[50]="You Cant't Use That Bitch!";

    Message(id,{55,130,71},szMsg,3.0);
    
    PlaySound(id,"battleplug/error.wav");

    return PLUGIN_HANDLED;
}

public Power_up_start(id)
{
    if(!is_user_alive(id))return;

    g_powerup[id]=1;

    if(IS_PL(id))
    {
        SetclientPL(id,2000000);
        PlaySound(id,"battleplug/hp.wav")
    }

}

public Power_up_end(id)
{
    g_powerup[id]=0;

    remove_task(id+TASK_ID);
}

public CheckSwitch(id)
{
    if(is_user_alive(id) && g_powerup[id] == 1)
    {
        g_powerup[id]=2;

        set_task(0.1,"Task_powerup",id+TASK_ID, .flags="b")
    }
}

public Task_powerup(id)
{
    id -= TASK_ID;

    SetclientPL(id,get_pdata_int(id,460)+1000);
}

public Write_SystemData(id,frags,deaths)
{
    new name[64],writedata[128];

    pev(id, pev_netname, name, 63);

    new openF = fopen(file, "a+");

    if (openF)
    {  
        if(!Is_SameData(frags,deaths,name))
        {
            format(writedata, 127, "%s & %d & %d^n", name,frags,deaths);
            fputs(openF,writedata);
            fclose(openF);
        }
        else
        {
            fclose(openF);
        }
    }

    return 0;
}

public Reset_SystemData(Index)
{

    new writedata[128];
    new openF = fopen(file, "w+");

    if (openF)
    {  
        format(writedata, 127, "");
        fputs(openF,writedata);
        fclose(openF);
    }

    return 0;
}

public DisplayMenu(id)
{
	new sz_Mbody[256];
	new keys;

	new nLen =format(sz_Mbody,255,"杀我是猪^n^n");

	nLen += format(sz_Mbody[nLen],255-nLen,"^n1:Winer Kill 1^n");
	nLen += format(sz_Mbody[nLen],255-nLen,"^n2:Winer Kill 5^n");
	nLen += format(sz_Mbody[nLen],255-nLen,"^n3:Winer Kill 10^n");

	nLen += format(sz_Mbody[nLen],255-nLen,"^n0:Exit");

	keys = (1<<0 | 1<<1 | 1<<2 | 1<<3 | 1<<4 | 1<<5 | 1<<6 | 1<<7 | 1<<8 | 1<<9);

	show_menu(id,keys,sz_Mbody,8);

	client_print(id,print_chat,"上一次设置:%d个人头1局.",get_cvar_num("BattleLimt"));
}

public CheckMenuCmd(id,key,menu)
{
    new name[32];
    pev(id,pev_netname,name,31);

    switch(key)
	{
		case 0:
                {
                    set_cvar_num("BattleLimt",1);
                    client_print(0,print_chat,"%s 更改了比赛规则:1个头快速比赛 .",name);
                } 
		case 1:
                {
                    set_cvar_num("BattleLimt",5);
                    client_print(0,print_chat,"%s 更改了比赛规则:5个头友谊比赛 .",name);
                } 
		case 2:
                {
                    set_cvar_num("BattleLimt",10);
                    client_print(0,print_chat,"%s 更改比赛规则: 10个头正式比赛 .",name);
                } 
	}

    if(key>=1 || key<=3)
        PlaySound(0,"battleplug/start.wav");
}

//处理玩家登录倒计时
public _PlayerLoginCountDown(id)
{
    id -= TASK_LoginCountDown;

    if(g_PlayerStats[id][PS_IS_LOGGED]) 
    {
        remove_task(id+TASK_LoginCountDown);
        return;
    }

    new Float:time = get_gametime();

    new Count = TASK_LoginCountDown;

    Count -= time;

    if( Count <= 0 )
    {
        remove_task(id+TASK_LoginCountDown);
        client_print(id,print_chat,"[ 系统 ] 登录超时!!!");
        return;    
    }

    client_print(id,print_chat,"[ 系统 ] 请登录账号,剩余时间:%.f秒",Count);
}   

//处理玩家登录/注册菜单
public functionMainLoginMenu(id)
{
    if(g_PlayerStats[id][PS_IS_LOGGED]) return client_print(id,print_chat,"[ 系统 ] 你已经登录过了!!!");

    new text[64] = "Account Name: UN-LOGIN ^n";
    new loginMenu = menu_create("[ Login-Menu ]","LoginMenu_handle");
    
    menu_additem(loginMenu,text,"1",ADMIN_ADMIN);
    menu_additem(loginMenu,"Login^n","2",ADMIN_ALL);
    menu_addblank2(g_menu);
    menu_additem(loginMenu,"Register^n","3",ADMIN_ALL);
    menu_setprop(loginMenu,MPROP_EXIT,MEXIT_ALL);

    menu_display(id,loginMenu,0);

    return PLUGIN_CONTINUE;
}

//回调处理菜单选项结果
public LoginMenu_handle(id,menu,item)
{
    if(item == MENU_EXIT)
    {
        menu_destroy(menu);
        return PLUGIN_HANDLED;
    }

    new cmd[3];
    new access,callback;

    menu_item_getinfo(menu,item,access,cmd,2,_,_,callback);

    new ichoice = str_to_num(cmd);

    switch(ichoice) 
    {
        case 2: // 登录选项
        {
            //处理已经注册过的玩家
            if(g_PlayerStats[id][PS_IS_REGISTERED]) 
            {
                client_print(id, print_chat, "[系统] 请输入密码登录!!!");
                client_cmd(id, "messagemode login_password");
                g_bAwaitingPassword[id] = true;
            }
            else if(!g_PlayerStats[id][PS_IS_REGISTERED]) 
            {
                //处理尚未注册但选择登录的玩家
                client_print(id,print_chat,"[系统] 账号未注册,请先注册!!!");
                return PLUGIN_HANDLED;
            }
        }
        case 3: // 注册选项
        {
            if(g_PlayerStats[id][PS_IS_REGISTERED])
            {
                //玩家正在使用别人的注册账号
                client_print(id, print_chat, "[系统] 该名字已经注册过，请登录账号!!!");
                return PLUGIN_HANDLED;
            }

            client_print(id, print_chat, "[系统] 请输入注册密码");
            client_cmd(id, "messagemode register_password");
            g_bAwaitingPassword[id] = true;
        }
    }

    menu_destroy(menu);

    return PLUGIN_HANDLED;
}

// 增强密码验证--第一次
public HandleRegisterPassword(id)
{
    if(!g_bAwaitingPassword[id]) return PLUGIN_HANDLED;

    new szPassword[64];
    read_args(szPassword, charsmax(szPassword));
    remove_quotes(szPassword);
    trim(szPassword);

    // 密码复杂度验证
    if(!is_valid_password(szPassword)) 
    {
        client_print(id, print_chat, "[错误] 密码需要6-16位且包含字母和数字 debug:%s",szPassword);
        return PLUGIN_HANDLED;
    }

    copy(g_szCachedPassword[id], 63, szPassword);
    client_print(id, print_chat, "[系统] 请再次输入密码确认");
    client_cmd(id, "messagemode confirm_password");

    return PLUGIN_CONTINUE;
}

//密码验证--第二次
public HandleConfirmPassword(id)
{
    new szConfirmPassword[64];
    read_args(szConfirmPassword, charsmax(szConfirmPassword));
    remove_quotes(szConfirmPassword);
    trim(szConfirmPassword);

    // 密码复杂度验证
    if(!equal(g_szCachedPassword[id], szConfirmPassword)) 
    {
        client_print(id, print_chat, "[错误] 两次密码不一致，请重新验证");
        return PLUGIN_HANDLED;
    }

    // 验证成功，储存玩家数据到数据库
    new fname[64],ip[16];
    pev(id,pev_netname,fname,63);
    get_user_ip(id,ip,15,1);
    client_print(id, print_chat, "[ MySql ] %s 注册验证成功,等待服务器结果!",fname);

    upDataPlayerSQL(id,fname,szConfirmPassword,ip);

    return PLUGIN_CONTINUE;
}

//处理玩家注册上传的数据到mysql
public upDataPlayerSQL(index, _name[], _password[], _ip[]) 
{
    //更新储存玩家的密码到数据库
    new Query[256];
    format(Query, sizeof(Query), "INSERT INTO tb_user (Acc_name, Acc_password,register_time,Acc_ip) VALUES ('%s','%s',NOW(),'%s')", _name,_password,_ip);

    // 传递玩家数据到注册表回调函数
    new userData[64];
    userData[0] = index;
    copy(userData[1], 63, _name);

    SQL_ThreadQuery(g_sqlTuple, "HandleInsertNewPlayerData", Query, userData, sizeof(userData));

    //查询统计表是否有玩家数据，加载玩家数据
    format(Query,sizeof(Query), "SELECT Kills, Deaths, Wins, Losses FROM tb_stats WHERE Acc_id = (SELECT Acc_id FROM tb_user WHERE Acc_name='%s')",_name);
    SQL_ThreadQuery(g_sqlTuple, "LoadPlayerStats", Query, userData, sizeof(userData));

}

//加载玩家数据库数据
public LoadPlayerStats(FailState, Handle:query, error[], errNum, data[], dataSize)
{
    if(FailState != TQUERY_SUCCESS)
    {
        server_print("[ MySql ] 查询失败:%s 错误码(%d)", error, errNum);
        return;
    }

    new id = data[0];
    new name[64];
    copy(name,63,data[1]);

    if(SQL_NumResults(query) > 0)
    {
        g_PlayerStats[id][PS_TOTAL_KILLS] = SQL_ReadResult(query, 0);
        g_PlayerStats[id][PS_TOTAL_DEATHS] = SQL_ReadResult(query, 1);
        g_PlayerStats[id][PS_WINS] = SQL_ReadResult(query, 2);
        g_PlayerStats[id][PS_LOSES] = SQL_ReadResult(query, 3);

        client_print(id, print_chat, "[ MySql ] 玩家%s 数据加载成功!",name);

        //debug
        server_print("[ MySql ] 玩家%s 总杀人数:%d 总死亡数:%d 胜场:%d 负场:%d"
        ,name,
        g_PlayerStats[id][PS_TOTAL_KILLS],
        g_PlayerStats[id][PS_TOTAL_DEATHS],
        g_PlayerStats[id][PS_WINS],
        g_PlayerStats[id][PS_LOSES]);
    }

    SQL_FreeHandle(query);
}

public SQLOnIpUpdate(FailState, Handle:query, error[], errNum, data[], dataSize)
{
    new id = data[0];

    new name[64];
    pev(id,pev_netname,name,63);

    if (FailState != TQUERY_SUCCESS)
    {
        server_print("[ MySql ] 更新IP失败:%s 错误码(%d)", error, errNum);
    }

    client_print(id, print_chat, "[ MySql ] 账号'%s'更新IP数据!", name);
    server_print("[ MySql ] 玩家 %s Ip数据保存成功", name);

    g_PlayerStats[id][PS_IS_REGISTERED] = true;
    g_PlayerStats[id][PS_IS_LOGGED] = true;

    //释放内存
    SQL_FreeHandle(query);
    
}

//*验证登录账号密码
public HandleLoginPassword(id)
{
    new szPassword[64];
    read_args(szPassword, charsmax(szPassword));
    remove_quotes(szPassword);
    trim(szPassword);

    // 缓存密码用于后续验证
    copy(g_szCachedPassword[id], 63, szPassword);

    // 获取玩家名字
    new name[64];
    get_user_name(id, name, 63);

    // 构建查询语句，检查密码是否匹配
    new query[256];
    format(query, sizeof(query), "SELECT Acc_password FROM tb_user WHERE Acc_name = '%s'", name);

    // 存储id和密码
    new data[65];
    data[0] = id;
    copy(data[1], 64, szPassword);

    // 执行异步查询
    SQL_ThreadQuery(g_sqlTuple, "onPasswordCheck", query, data, sizeof(data));
}

// 回调处理登录密码验证
public onPasswordCheck(FailState, Handle:query, error[], errNum, data[], dataSize)
{
    new id = data[0];
    new inputPassword[64];
    copy(inputPassword, 64, data[1]);

    new tempdata[65];
    tempdata[0] = id;
    copy(tempdata,64,data[1]);

    new name[64];
    pev(id,pev_netname,name,63);

    if (FailState != TQUERY_SUCCESS)
    {
        server_print("[ MySql ] 查询失败:%s 错误码(%d)", error, errNum);
        client_print(id, print_chat, "[ MySql ] 查询失败，请稍后再试。");
        return;
    }

    if (SQL_NumResults(query) > 0)
    {
        new dbPassword[64];
        SQL_ReadResult(query, 0, dbPassword, sizeof(dbPassword));

        if (equal(inputPassword, dbPassword))
        {
            g_PlayerStats[id][PS_IS_LOGGED] = true;

            client_print(id, print_chat, "[ MySql ] 登录成功，欢迎回来！");
            server_print("[ MySql ] 玩家 %s 登录成功", name);

            new ip[16];
            get_user_ip(id, ip, 15, 1);

            // 更新IP
            new update_query[128];
            format(update_query, charsmax(update_query),"UPDATE `tb_user` SET `Acc_ip` = '%s' WHERE `Acc_name` = '%s'",ip, name);
            SQL_ThreadQuery(g_sqlTuple, "SQLOnIpUpdate", update_query,tempdata,sizeof(tempdata));

            // 加载玩家数据
            format(update_query, charsmax(update_query), "SELECT Kills, Deaths, Wins, Losses FROM tb_stats WHERE Acc_id = (SELECT Acc_id FROM tb_user WHERE Acc_name='%s')", name);
            SQL_ThreadQuery(g_sqlTuple, "LoadPlayerStats", update_query, tempdata, sizeof(tempdata));
        }
        else
        {
            client_print(id, print_chat, "[ MySql ] 密码错误，请重试。");
            server_print("[ MySql ] 玩家 %s 尝试登录，但密码错误", pev(id,pev_netname));
        }
    }
    else
    {
        client_print(id, print_chat, "[ MySql ] 未找到用户数据，请注册。");
        server_print("[ MySql ] 玩家 %s 尝试登录，但未找到用户数据", pev(id,pev_netname));
    }
}

public functionMainVoteMenu(id)
{
    if  ( gVoting ) 
    { 
        client_print ( id, print_chat, "[ 系统 ] 已经开始投票,或者投过票了,请稍等片刻。"  ) ;
        return PLUGIN_HANDLED;
    }

    arrayset( g_Votes, 0, sizeof g_Votes );

    g_menu = menu_create("[     1 v 1  Menu-Rule-Vote   ]","voteMenu_handle");

    menu_additem(g_menu," Rule : Kill : 1^n","1",ADMIN_ALL);
    menu_additem(g_menu," Rule : Kill : 5^n","2",ADMIN_ALL);
    menu_additem(g_menu," Rule : Kill : 10^n","3",ADMIN_ALL);
    menu_setprop(g_menu,MPROP_EXIT,MEXIT_ALL);

    //如果已经有一个投票，不要启动另一个投票

    for(new i = 1 ; i <= get_maxplayers() ; i++)
    {
        if(!is_user_connected(i))continue;

        menu_display(i,g_menu,0);

        gVoting++;
    }

    set_task ( 10.0 , "EndVote"  ) 

    client_print ( id, print_chat,"[ 服务器通告 ] 十秒钟后显示投票结果!"  ) ;

    return PLUGIN_HANDLED;

}

public voteMenu_handle(id,menu,item)
{
    if(item == MENU_EXIT  || !gVoting) 
    {
        client_print(0,print_chat,"[ 投票系统 ] %d号玩家弃权!",id);
        return PLUGIN_HANDLED;
    }

    new cmd[3];
    new access,callback;

    menu_item_getinfo(menu,item,access,cmd,2,_,_,callback);

    new ichoice = str_to_num(cmd);

    g_Votes[ ichoice ] ++;

    client_print(0,print_chat,"[ 投票系统 ] 玩家:%d , 选择了第:%s个选项 , 目前选项:%d的总票数: %d ",id,cmd,ichoice,g_Votes[ichoice]);

    return PLUGIN_HANDLED;
}

 public EndVote (id) 
 { 
    menu_destroy ( g_menu ) ;

    show_menu( id, 0, "^n", 1 );

    if  ( g_Votes [ 1 ] > g_Votes [ 2 ] && g_Votes[ 1 ] > g_Votes [ 3 ]) 
    {
        client_print ( 0 , print_chat, "第一个选项获得最多票数 (总票:%d )" , g_Votes [ 1 ]  ) ;

        set_cvar_num("BattleLimt",1);

        client_print(0,print_chat,"[ 通告 ] 投票通过-> 更改比赛规则:1个头快速比赛 .");

        PlaySound(0,"battleplug/start.wav");

    }
    else  if  ( g_Votes [ 1 ] < g_Votes [ 2 ] && g_Votes[ 2 ] > g_Votes[ 3 ] )
    {
        client_print ( 0 , print_chat, "第二个选项获得最多票数 (总票:%d )" , g_Votes [ 2 ]  ) ;

        set_cvar_num("BattleLimt",5);

        client_print(0,print_chat,"[ 通告 ] 投票通过-> 更改比赛规则:5个头友谊比赛 .");

        PlaySound(0,"battleplug/start.wav");

    }
    else  if (g_Votes [ 1 ] < g_Votes [ 3 ] && g_Votes[ 3 ] > g_Votes[ 2 ])
    {
        client_print ( 0 , print_chat, "第三个选项获得最多票数 (总票:%d )" , g_Votes [ 3 ]  ) ;

        set_cvar_num("BattleLimt",10);

        client_print(0,print_chat,"[ 通告 ] 投票通过--> 更改比赛规则:10个头正式比赛 .");

        PlaySound(0,"battleplug/start.wav");

    }
    else
        client_print ( 0 , print_chat, "[ 通告 ] 投票打平,未通过呢!"  ) ;

    //重置没有玩家投票
    gVoting =  0 ;

    new i = 0 ;

    while (i < 4 )
    {
        g_Votes[ i ] = 0;

        i++;
    }

}

//检测处理玩家加入比赛函数
public hookJoint(id)
{
    new agi  = read_argv_int(id);
    
    if( g_PlayerStats[id][PS_IS_LOGGED] == false)
    {
        PlaySound(id,"battleplug/error.wav");

        client_print(id,print_chat,"[ 系统 ] 未登录账号,禁止加入比赛!!!");
        
        return PLUGIN_HANDLED;
    }

    if( g_iBattle==true && g_iWarrior[id]==true)
    {
        PlaySound(id,"battleplug/error.wav");

        client_print(id,print_chat,"江湖规矩 1v1 少侠切勿得了心魔.");
        
        return PLUGIN_HANDLED;
    }

    // 2v2 开赛后禁止再加入队伍，保持 2v2 人数和结果判定稳定
    if( g_iBattle==true && g_autoTeamSize==2 )
    {
        PlaySound(id,"battleplug/error.wav");
        client_print(id,print_chat,"[ 排位 ] 2v2 比赛已经开始，不能再更换队伍.");
        return PLUGIN_HANDLED;
    }

    if( agi == 5  )
    {
        PlaySound(id,"battleplug/error.wav");

        client_print(id,print_chat,"又被你发现bug了,可惜已经修复了!");
        
        return PLUGIN_HANDLED_MAIN;      
    }

    return PLUGIN_CONTINUE;
}

// public hookClass(id)
// {
//     static szMsg[50]="[Battle Start]You Cant't Class Change!";

//     Message(id,{255,130,71},szMsg,3.0);

//     PlaySound(id,"battleplug/error.wav");

//     return PLUGIN_HANDLED_MAIN;
// }

//Orpheu
// public hookChange_Class(id)
// {
//     HandleCmd_ArgsHook = OrpheuRegisterHook(OrpheuGetEngineFunction("pfnCmd_Args", "ReadArgs"), "pfnCmd_Args")

//     return PLUGIN_HANDLED;
// }

// public OrpheuHookReturn:pfnCmd_Args()
// {
//     OrpheuSetReturn("change_team")
//     OrpheuUnregisterHook(HandleCmd_ArgsHook)
//     return OrpheuOverride
// } 

public checkJoint(id)
{
    static agv[20];
    
    read_argv(0,agv,sizeof(agv));

    if(equal(agv,"change_team") && g_iBattle==true && g_iWarrior[id]==true)
    {
        client_cmd(id,"slot7");

        new szMsg[50]="[Battle Start] You Can't Joint The Current Game "
        
        Message(id,{212,137,135},szMsg,3.0);

        PlaySound(id,"battleplug/error.wav");

        return PLUGIN_HANDLED;
    }

    return PLUGIN_CONTINUE;
}

public PlayerPostThink(id)
{
    if(!is_user_alive(id) && ! is_user_connected(id))return FMRES_HANDLED;

    if(g_userCount[id]==2)
    {
        KickPlayer(id);
        client_print(0,print_chat,"这位少侠跟着他的梦想被放逐到另外的世界了..");
    }

    if(get_pdata_int(id,230) && pev(id,pev_button) & IN_USE && entity_get_int( id, EV_INT_flags ) & FL_ONGROUND)
    {
        if(!is_user_alive(id))return FMRES_HANDLED;

        new Name[32],Ip[16];

        pev(id,pev_netname,Name,63);
        get_user_ip(id,Ip,15,0);
        
        user_silentkill(id);
        message_begin(MSG_ALL,get_user_msgid("DeathMsg"));
        write_byte(id);
        write_byte(id);
        write_string("服务器不可按B");
        message_end();

        g_userCount[id]++;

        switch(g_userCount[id])
        {
            case 1:
                {
                    client_print(0,print_chat,"警告玩家[ %s ] , IP:%s , 第%d次按b。",Name,Ip,g_userCount[id]);
                }
        }

        return FMRES_SUPERCEDE;
    }
    
/*              
                2024.12.18
    [  fix ] block clcmd_jump function 
*/

    if(!g_iBattle)return FMRES_HANDLED;

    if(get_pdata_int(id,230))
    {
        if( entity_get_int( id, EV_INT_flags ) & FL_ONGROUND && pev(id, pev_button) & IN_JUMP )
        {
            client_cmd(id,"-jump;wait;-jump;wait;-jump");
        }
    }
    
    //待修正应使用正确的Handsandwich
    // DisplayDmg(id);

    return FMRES_IGNORED;
}

//自动检测1v1玩家准备状态
public PlayerPreThink(id)
{
    if(g_BattleState == false ) return FMRES_IGNORED;

    // 约战优先：按击杀/死亡阈值结算；排位则按队伍全灭结算
    // 约战必须先等异步战绩/结果落库，不能立即 resetAll 排 5 秒 quit，
    // 否则数据库慢时客户端已经退出，平台拿不到结果。
    if(checkChallengeFinish())
    {
        return FMRES_HANDLED;
    }

    if(checkRankedFinish())
    {
        resetAll();
        return FMRES_HANDLED;
    }

    if(checkTeamWinner())
    {
        resetAll();
        return FMRES_HANDLED;
    }

    //检测已经分出胜负情况
    if(g_SpawnCount <=1 && g_iBattle == true)
    {
        checkWinner();
        resetAll();
        return FMRES_HANDLED;
    }
    else if(g_SpawnCount > 1 && g_iBattle== true)/* 检测人数足够,开始比赛的局面 */
    {
        UpData();//lock
        // checkJoint(id)
    }

    return FMRES_IGNORED;
}

//玩家复活函数
public playerSpawn(id)
{
    if(BattleFlag == 0)
        autoPlayerStart();
    
    if(!g_iBattle)return;

    if(!g_iWarrior[id])return;

    if(!is_user_alive(id))return;

    if(Is_Bot(id))
    {
        KickBot(id);
    }

    //client_print(id,print_chat,"少侠,手速快才是真的快。");

    //client_cmd(id,"spectate");

    //forceSpectator(id);
    
    //PlaySound(id, "battleplug/error.wav");
}

//处理玩家投降函数
public ezSpectate(id)
{
    if(!g_iBattle || g_iWarrior[id] )return;

    forceSpectator(id);

    resetAll();
}

//强制处理玩家为观战模式函数
public forceSpectator(id)
{
    if(!is_user_connected(id))return;

    new team = entity_get_int(id,EV_INT_team);

    if(Is_Bot(id))
    {
        KickBot(id);
    }

    if(team>0)
    {
        
        client_cmd(id,"spectate");

        set_task(1.0,"forceSpectator",id);
    }

    ResetScored(id,0,0);
}

public event_deathmsg()
{   
    new attack=read_data(1);
    new victim=read_data(2);

    // 约战独立计数器：部分 ESF 模式不会把击杀写入引擎 frags，不能依赖 get_user_frags。
    if(g_challengeActive && !g_challengeSettled)
    {
        if(victim > 0 && victim <= get_maxplayers() && g_challengeTeam[victim] != 0)
            g_challengeDeaths[victim]++;
        if(attack > 0 && attack != victim && attack <= get_maxplayers() && g_challengeTeam[attack] != 0)
            g_challengeKills[attack]++;
        if(g_challengeKnown > 0)
            checkChallengeFinish();
    }

    // g_iWarrior[victim]=false;

    if(g_iWarrior[victim] && g_iBattle)return;

    // client_print(victim,print_chat,"g_iWarrior=%d",g_iWarrior[victim]);

    new Efrags=get_user_frags(victim);
    new Gfrags=get_user_frags(attack);
    new death=get_user_deaths(victim);

    if(!attack || attack==victim)
    {
        new name[32];
        pev(victim,pev_netname,name,31);
        ResetScored(victim,++Efrags,++death);
        client_print(0,print_chat,"惩罚通告 : [ %s ] 玩家自杀，死亡数 +1 !",name);
    }

    death++;

    if(Gfrags >=get_cvar_num("BattleLimt") || death>=get_cvar_num("BattleLimt"))
    {
        // Write_SystemData(victim,frags,death);
        g_iWarrior[victim]=true;
        forceSpectator(victim);

        --g_SpawnCount;
        PlayLoser(victim);

        client_print(0,print_chat,"[ 服务器通告 ] : 目前规则为杀:%d人,玩家需要更改可输入/vote投票",get_cvar_num("BattleLimt"));
        //set_task(10.0,"Reset_SystemData",victim);
    }

    set_task(0.5,"MyFunctionSpawn",victim,_,_,"a",2);
}

/*************自用功能函数******************/

public DisPlayBattle(id)
{
    if(g_iBattle==false)return;

    new iMusic = random_num( 0, 9 );

    PlaySound(0,"battleplug/0.wav");

    new szMusic[68];
    format(szMusic,67,"battleplug/music%d.mp3",iMusic);

    PlayMusic( 0, szMusic );

    MessageCenter(0,{255,255,0},"Battle Start",5.0)
}

// public DisplayDmg(victim)
// {
// 	new attacker=get_user_attacker(victim);

// 	if(!attacker)return;

// 	new Damage
// 	Damage = pev( attacker, pev_dmg_take )

// 	if(Damage > 0 && !esf_get_advancedmelee(attacker))
// 	{
// 		showDmg(attacker,Damage);
// 	}
// }

// public showDmg(id,Dmg)
// {
// 	message_begin(MSG_ONE_UNRELIABLE,121,_,id);
// 	write_byte(3);
// 	write_byte(Dmg);
// 	message_end();
// }

public SetSpawn(id)
{
    if (!is_user_connected(id) || is_user_alive(id) || get_user_team(id)==3)
        return;
    
    // 给予玩家死亡等待复活状态并且思考
    set_pev(id, pev_deadflag, DEAD_RESPAWNABLE)
    dllfunc(DLLFunc_Think, id)
    
    //检测玩家是否给予等待复活的状态.
    if (pev(id, pev_deadflag) == DEAD_RESPAWNABLE)
    {
        dllfunc(DLLFunc_Spawn, id);
    }
}

public MyFunctionSpawn(id)
{
    if(is_user_alive(id))return;

    client_cmd(id, "+attack2;wait;-attack2");
}

public ResetScored(id,frags,deaths)
{
    // 75 = ScoreInfo
    message_begin(MSG_ALL,75);
    write_byte(id);
    write_short(frags);
    write_short(deaths);
    write_short(0);//ping
    write_short(0);//class
    write_short(Get_Team(id));
    message_end();

    set_user_frags(id,frags);
    set_pdata_int(id,604,deaths);
}

public ResetS(id)
{
    set_pev(id,pev_frags,0);
    set_pdata_int(id,604,0);

    message_begin(MSG_ALL,75);
    write_byte(id);
    write_short(0);
    write_short(0);
    write_short(0);
    write_short(0);
    write_short(Get_Team(id));
    message_end();
}

// public ResetScreenFade(Duration,HoldTime,Flags,ColorR,ColorG,ColorB,Alpha)
// {
// 	message_begin(MSG_ALL,get_user_msgid("ScreenFade"));
// 	write_short(0);
// 	write_short(0);
// 	write_short(0x0000);
// 	write_byte(1);
// 	write_byte(2);
// 	write_byte(3);
// 	write_byte(0);
// 	message_end();

// 	return	PLUGIN_CONTINUE;
// }

public set_kill(id)
{
    user_silentkill(id);
}

public KickBot(id)
{
    if(!is_user_connected(id))return;

    server_cmd("kick #%d",get_user_userid(id));
}

public resetall(id)
{
    g_iBattle=false;
    
    for(new j=1;j<=get_maxplayers();j++)
    {
        g_iWarrior[j]=false;
    }

    client_print(id,print_chat,"重置");
}

//debug
public seekstatus(id)
{
    client_print(id,print_chat,"g_ibattle的状态:%d",g_iBattle);
    client_print(id,print_chat,"g_iWarrior的状态:%d",g_iWarrior[id]);
    client_print(id,print_chat,"g_goodIndex的索引号:%d",GoodIndex);
    client_print(id,print_chat,"g_EvilIndex的索引号:%d",EvilIndex);
}

//debug
public seekData(id)
{
    // UTIL_SetMaxHealth(id,1);

    message_begin(MSG_ALL,75);
    write_byte(id);
    write_short(4);
    write_short(6);
    write_short(0);
    write_short(0);
    write_short(Get_Team(id));
    message_end();

    // entity_set_int( id, EV_FL_frags, 3);
    set_pdata_int(id,356,4);
    set_pdata_int(id,604,6);

    new a,b;
    a = get_user_frags(id)
    b = get_user_deaths(id);

    client_print(id,print_chat,"kill:%d  | death : %d",a,b);

}

public Three()
	PlaySound( 0, "battleplug/3.wav" );

public Two()
	PlaySound( 0, "battleplug/2.wav" );

public One()
	PlaySound( 0, "battleplug/1.wav" );


stock KickPlayer(Index)
{
    if(!is_user_connected(Index))return ;

    server_cmd("kick #%d",get_user_userid(Index));
}

stock Get_Team(Index)
{
    new szTeamName[2];
    
    get_user_team(Index,szTeamName,1);

    switch(szTeamName[0])
    {
        case 'G':return 1;//good
        case 'E':return 2;//evil
    }

    return 0;
}

stock Is_Bot(Index)
{
    return (entity_get_int(Index,EV_INT_flags)  &  FL_FAKECLIENT ) ?   true  :  false;
}

stock IS_PL(Index)
{
    return (get_pdata_int(Index,460) >= MAXPL) ? true : false;
}

stock PlayLoser(Index)
{
    new iMusic = random_num(1,4),szMusic[68];
    format(szMusic,67,"battleplug/lose%d.mp3",iMusic);
    PlayMusic(Index,szMusic);
}

stock MessageCenter( id, Color[ 3 ], const Message[], Float:Duration = 2.0 )
{
	set_hudmessage( Color[ 0 ], Color[ 1 ], Color[ 2 ], -1.0, 0.35, 0, 0.0, Duration, 0.0, 1.0, -1 );
	show_hudmessage( id, Message );
}

stock Message( id, Color[ 3 ], const Message[], Float:Duration = 3.0 )
{
	set_hudmessage( Color[ 0 ], Color[ 1 ], Color[ 2 ], 0.15, 0.65, 1, 6.0, Duration, 0.5, 2.0, 114 );
	show_hudmessage( id, Message );
}

stock PlayMusic(id, const sound[] )
{
    client_cmd( id, "mp3 play sound/%s", sound);
}

stock StopMusic(id)
{
    client_cmd(id, "mp3 stop");
}

stock PlaySound(id,const sound[])
{
    client_cmd(id,"spk sound/%s",sound);
}

stock UTIL_SetMaxHealth( id, health )
{
	set_pev( id, pev_health, float( health ) );
	
	message_begin( MSG_ONE_UNRELIABLE, 67, _, id );
	write_byte( health );
	message_end( );
}

stock SetclientPL(id,powerLevel)
{
    set_pdata_int( id, 460,  powerLevel, 5 );
    set_pdata_int( id, 461,  powerLevel, 5 );
}

/** 2v2 无平台身份时的兜底胜负：一方全灭即结束 */
bool:checkTeamWinner()
{
    if(g_autoTeamSize != 2 || !g_iBattle) return false;

    new goodAlive = 0, evilAlive = 0;
    for(new i = 1; i <= get_maxplayers(); i++)
    {
        if(!is_user_connected(i) || g_iWarrior[i]) continue;
        new team = Get_Team(i);
        if(team == 1) goodAlive++;
        else if(team == 2) evilAlive++;
    }

    if(goodAlive > 0 && evilAlive > 0) return false;
    if(goodAlive == 0 && evilAlive == 0) return false;

    new winnerName[8];
    copy(winnerName, charsmax(winnerName), (goodAlive > 0) ? "Good" : "Evil");
    new msg[64];
    formatex(msg, charsmax(msg), "[ 2v2 结束 ] 获胜方: %s", winnerName);
    MessageCenter(0, {0,255,0}, msg, 8.0);
    client_print(0, print_chat, "[ 2v2 ] 比赛结束，%s 队获胜", winnerName);
    return true;
}

stock checkWinner()
{
    new playerCount = 0;    new iWinner = 0 ;
    new i = 1;


    while( i <= get_maxplayers())
    {
        if(!is_user_connected( i ) )continue;
		
        if(Get_Team( i ) > 0 && g_iWarrior[ i ] == false)
        {
            iWinner = i;
            playerCount++; 
        }

    	if( playerCount > 0 )
			break;
        i++;
    }

    if(iWinner != 0 )
    {
        new szName[50];
        get_user_name(iWinner,szName,49);
        
        new szmsg[150];
        format(szmsg,149,"[ WINNER : %s ]",szName);

        PlayMusic(iWinner,"battleplug/win.mp3");

        MessageCenter(0,{0,255,0},szmsg,10.0);

        ResetScored(iWinner,0,0);
    }
}

stock SetPlayerFrozen(const id, status )
{
	new UserFlags = entity_get_int( id, EV_INT_flags );

	set_pdata_int( id , 301, status, -89 );
	set_pdata_int( id, 218, status, 4);

	entity_set_int(id, EV_INT_flags, status? (UserFlags | FL_FROZEN):(UserFlags & ~FL_FROZEN));
}

//修正ip地址,去掉端口号
stock GetIpCh(index,Ip[],const size, flag)
{
    if(strlen(Ip)==0) {flag=1;return Ip;}

    new line = 0;
    new End[16];

    while(line<size && Ip[line]!=':' )
    {
        End[line]=Ip[line];

        line++;
    }

    copy(Ip,line,End);

    return Ip;
}

//检测注册状态有效密码
stock bool:is_valid_password(const password[])
{

/*    new len = strlen(password);
    if(len < 6 || len > 16) return false;

    new has_alpha, has_digit;
    for(new i=0; i<len; i++) 
    {
        if(isalpha(password[i])) has_alpha = 1;
        if(isdigit(password[i])) has_digit = 1;
    }
    
    return (has_alpha && has_digit);
*/

    // 正则表达式规则：
    // 1. 必须包含至少一个字母（大小写均可）
    // 2. 必须包含至少一个特殊符号（!@#$%^&*）
    // 3. 总长度6-16位
    new pattern[] = "[A-Za-z0-9]{6,15}";
    
    // 使用 regex_match_simple 直接匹配
    new result = regex_match_simple(
        password,       // 待检查的密码
        pattern,        // 正则表达式模式
        PCRE_CASELESS,  // 忽略大小写（可选）
        _,              // 错误消息缓冲区（不需要）
        0,              // 缓冲区长度
        _               // 错误码（不需要）
    );
    
    return (result > 0) ? true : false;

}

build_menu()
{
    menu_additem(g_menu,"yes","1");
    menu_additem(g_menu,"no","2");
    menu_setprop(g_menu,MPROP_PERPAGE,0);
}

//监控比赛开始的状态
UpData()
{
    new GoodPlayerCount=0,
        EvilPlayerCount=0;

    // 2v2：双方各保留前两名参战，其余全部观战
    if(g_autoTeamSize == 2)
    {
        GoodIndex = 0;
        EvilIndex = 0;
        for(new k = 1 ; k <= get_maxplayers() ; k++)
        {
            if(!is_user_connected(k)) continue;
            new team = Get_Team(k);
            if(team == 1 && GoodPlayerCount < 2)
            {
                GoodPlayerCount++;
                g_iWarrior[k] = false;
                if(GoodIndex == 0) GoodIndex = k;
            }
            else if(team == 2 && EvilPlayerCount < 2)
            {
                EvilPlayerCount++;
                g_iWarrior[k] = false;
                if(EvilIndex == 0) EvilIndex = k;
            }
            else
            {
                g_iWarrior[k] = true;
            }
        }
        return;
    }

    for(new k = 1 ; k <= get_maxplayers() ; k++)
    {
        if(!is_user_alive(k) && !is_user_connected(k))continue;

        if(GoodIndex!=0 && EvilIndex!=0 || GoodPlayerCount>1 || EvilPlayerCount>1 )break;
        
        if(Get_Team(k)==1)
        {
            if(GoodPlayerCount==0)
                {
                    GoodIndex=k;
                    GoodPlayerCount++
                }
            else
                {
                    EvilIndex=k;
                    EvilPlayerCount++;
                }
        }
        else if(Get_Team(k)==2)
        {
            if(EvilPlayerCount==0)
                {
                    EvilIndex=k;
                    EvilPlayerCount++
                }
            else
                {
                    GoodIndex=k;
                    GoodPlayerCount++;
                }
        }
    }

    if(get_user_deaths(GoodIndex)>= get_cvar_num("BattleLimt") || get_user_deaths(EvilIndex)>= get_cvar_num("BattleLimt") || 
       get_user_frags(GoodIndex) >= get_cvar_num("BattleLimt") || get_user_frags(EvilIndex) >= get_cvar_num("BattleLimt"))return;

    if(GoodPlayerCount==1 && EvilPlayerCount==1)
    {
        g_iWarrior[GoodIndex]=false;
        g_iWarrior[EvilIndex]=false;
    }
    
    for (new h = 1; h <= get_maxplayers(); h++)
    {
        if (h != GoodIndex && h != EvilIndex )
        {
            g_iWarrior[h] = true;
        }
    }
}

InitilizeBattleStart()
{
    BattleFlag=1;

    for(new i =1 ; i <= get_maxplayers() ; i++)
    {   
        if( !is_user_connected( i ))continue;

        if( g_iWarrior[ i ] == true)continue;

        ResetScored(i,0,0);
        StopMusic(i);
    }
  
    set_task(1.5,"Three",TASK_SERVER);
    set_task(2.5,"Two",TASK_SERVER);
    set_task(3.5,"One",  TASK_SERVER);
    set_task(4.5,"DisPlayBattle",TASK_SERVER);

    client_print(0,print_chat,"[ 认输 ] 公屏敲出ez即可!"); 

    client_print(0,print_chat,"比赛正式开始!"); 

    // 重新识别平台排位队伍（支持连续开下一场）
    for(new i = 1; i <= get_maxplayers(); i++)
    {
        if(is_user_connected(i))
            set_task(2.0, "taskRankedIdentify", TASK_RANKED + i);
    }
}

Is_SameData(frags,deaths,name[])
{
    new DataFrags,DataDeaths;
    new parseData[128],parseName[64],parseFrags[8],parseDeaths[8],txtlen;

    new Fname[64];
    format(Fname,63,"%s",name);

    new fsize=file_size(file,1);

    new line=0;

    while(line<=fsize)
    {
        read_file(file,line,parseData,127,txtlen);
        parse(parseData,parseName,63);
        if(equal(Fname,parseName))
        {
            DataFrags =str_to_num(parseFrags);
            DataDeaths=str_to_num(parseDeaths);
            
            if(frags==DataFrags && deaths==DataDeaths)
            {
                return 1;
            }
        }
        line++;
    }

    return 0;
}

resetAll()
{
    if(BattleFlag==0)return;

    new bool:wasBattle = g_iBattle;
    new bool:wasChallenge = g_challengeActive;

    GoodIndex=0;
    EvilIndex=0;
    BattleFlag=0;
    g_autoTeamSize=0;
    g_rankedMatchId=0;
    g_rankedKnown=0;
    g_rankedSeenA=0;
    g_rankedSeenB=0;
    g_rankedSettled=false;
    for(new i = 1; i <= get_maxplayers(); i++) g_rankedTeam[i]=0;

    g_challengeActive = false;
    g_challengeRoomId = 0;
    g_challengeKnown = 0;
    g_challengeSettled = false;
    for(new i = 1; i <= get_maxplayers(); i++)
    {
        g_challengeTeam[i] = 0;
        g_challengeUserId[i] = 0;
        g_challengeBaseKills[i] = 0;
        g_challengeBaseDeaths[i] = 0;
        g_challengeKills[i] = 0;
        g_challengeDeaths[i] = 0;
    }

    g_iBattle     = false;
    g_BattleState = false;

    for(new i=1;i<=get_maxplayers();i++)
    {
        g_iWarrior[i]=false;
        // StopMusic(i);
    }

    client_print(0,print_chat,"比赛结束!");

    // 约战结束必须回平台；排位仍尊重 battle_quit_enable 开关。
    if(wasBattle && (get_pcvar_num(g_pcQuitEnable) || wasChallenge))
    {
        set_task(get_pcvar_float(g_pcQuitDelay), "taskQuitToPlatform", TASK_QUIT);
    }
}

public taskQuitToPlatform()
{
    for(new i = 1; i <= get_maxplayers(); i++)
    {
        if(is_user_connected(i) && !Is_Bot(i))
            client_cmd(i, "quit");
    }
    log_amx("[Ranked] quit game after match end");
}

autoPlayerStart()
{
    g_SpawnCount = 0;

    new goodCount = 0, evilCount = 0;
    for(new i = 1 ; i <= get_maxplayers() ; i++)
    {
        if(!is_user_connected(i)) continue;
        new team = Get_Team(i);
        if(team == 1) goodCount++;
        else if(team == 2) evilCount++;
        if(team > 0) g_SpawnCount++;
    }

    // 自动检测：双方人数相等且各 1-2 人时开赛；1 人=单排，2 人=2v2
    if(BattleFlag == 0 && goodCount == evilCount && goodCount >= 1 && goodCount <= 2)
    {
        g_autoTeamSize = goodCount;
        g_iBattle = true;
        g_BattleState = true;
        InitilizeBattleStart();
        for(new i = 1; i <= get_maxplayers(); i++)
        {
            if(is_user_connected(i) && !Is_Bot(i))
                set_task(1.5, "taskChallengeIdentify", TASK_CHALLENGE + i);
        }
    }
}

//更新icon数组动态居中
public showIconDisplay(id)
{
    if(!g_iBattle || GoodIndex == 0 || EvilIndex == 0)return;

    // 2v2 队伍 HUD：显示双方队伍名和总击杀
    if(g_autoTeamSize == 2)
    {
        new goodNames[128], evilNames[128], gScore = 0, eScore = 0;
        new name[32];
        for(new i = 1; i <= get_maxplayers(); i++)
        {
            if(!is_user_connected(i) || g_iWarrior[i]) continue;
            get_user_name(i, name, charsmax(name));
            if(Get_Team(i) == 1)
            {
                gScore += get_user_frags(i);
                if(goodNames[0] != 0) add(goodNames, charsmax(goodNames), " + ");
                add(goodNames, charsmax(goodNames), name);
            }
            else if(Get_Team(i) == 2)
            {
                eScore += get_user_frags(i);
                if(evilNames[0] != 0) add(evilNames, charsmax(evilNames), " + ");
                add(evilNames, charsmax(evilNames), name);
            }
        }
        new icon[512];
        format(icon, charsmax(icon), "[ %s ]  %d  :  %d  [ %s ]", goodNames, gScore, eScore, evilNames);
        set_hudmessage(133, 166, 255, 0.44, 0.0, 0, 0.0, 3.0, 1.0, 2.0, 121);
        show_dhudmessage(0, icon);
        return;
    }

    new fGood[32],fEvil[32],icon[1024],Float:GFrags,Float:EFrags;
    new Gstr_frags[32],Estr_frags[32];

    pev(GoodIndex,pev_netname,fGood,31);pev(EvilIndex,pev_netname,fEvil,31);pev(GoodIndex,pev_frags,GFrags);pev(EvilIndex,pev_frags,EFrags);

    //计算和塞入空格
    calculate_InsetStrl(fGood,Gstr_frags,GFrags);
    calculate_InsetStrl(fEvil,Estr_frags,EFrags);
    
    format(icon,1023,"[  %s  ]   VS   [  %s  ] ^n    %s      :      %s   ",fGood,fEvil,Gstr_frags,Estr_frags);

    set_hudmessage( 133,166,255, 0.44, 0.0, 0, 0.0, 3.0, 1.0, 2.0, 121 );
    show_dhudmessage( 0, icon);

}


stock calculate_InsetStrl(str1[],str2[],Float:InValue)
{
    new len = strlen(str1) + 3 ;
    new mid = len / 2 ;
    new spe = 0 ; 

    new tempStr[3];
    format(tempStr, sizeof(tempStr), "%.f", InValue);

    for(new i = 0 ; i < len ; i++)
    {
        if(i < mid)
        {
            str2[i] = 0x20;
        }
        else if (i == mid)
        {
            spe = i ;
            copy(str2[i],strlen(str2),tempStr);
        }
        else if (i > mid && spe !=0 )
        {
            str2[i] = 0x20;
            spe--;
        }
        else if(i > mid && spe == 0)
        {
            break;
        }
    }
}

stock ResetPlayerStats(id)
{
    // 重置注册和登录状态
    g_PlayerStats[id][PS_IS_REGISTERED] = false;
    g_PlayerStats[id][PS_IS_LOGGED] = false;
    g_PlayerStats[id][PS_IS_CHANGEINFO] = false;
    
    // 重置战斗数据
    g_PlayerStats[id][PS_TOTAL_KILLS] = 0;
    g_PlayerStats[id][PS_TOTAL_DEATHS] = 0;
    g_PlayerStats[id][PS_WINS] = 0;
    g_PlayerStats[id][PS_LOSES] = 0;
}

public plugin_end()
{
    remove_task(TASK_TIMEREMAIN_LARGE);
    remove_task(TASK_SERVER);

    //释放数据库连接配置
    if(g_sqlTuple != Empty_Handle)
        SQL_FreeHandle(g_sqlTuple);
}

public plugin_init()
{
    register_plugin("FCX_BATTLE", "1.0.0-ranked", "CLOUD / ESF Platform");

//--------------------START_PRE--------------------
    // 自动检测模式：沿用启动器/地图的 mp_gamemode（0=混战，2=组队），不再强制覆盖
//--------------------Event---------------------
    register_event("DeathMsg", "event_deathmsg", "a");
    register_event("ResetHUD","playerSpawn","be");

//---------------------FM-----------------------
    // register_forward(FM_ClientCommand,"blockCommand"); 
    register_forward(FM_PlayerPreThink,"PlayerPreThink");
    register_forward(FM_PlayerPostThink,"PlayerPostThink")

//---------------------MSG---------------------

    register_message(get_user_msgid("SayText"), "HookSayText");// 拦截系统 SayText 消息

//----------------Register_Cvar-----------------
    register_cvar("BattleLimt","10");

    g_pcRankedHost      = register_cvar("ranked_sql_host", "");
    g_pcRankedUser      = register_cvar("ranked_sql_user", "esf_amxx");
    g_pcRankedPass      = register_cvar("ranked_sql_pass", "");
    g_pcRankedDb        = register_cvar("ranked_sql_db", "esf_platform");
    g_pcRankedServerKey = register_cvar("ranked_server_key", "");
    g_pcQuitEnable      = register_cvar("battle_quit_enable", "1");
    g_pcQuitDelay       = register_cvar("battle_quit_delay", "5.0");
    g_pcPlatformLogin   = register_cvar("battle_platform_login", "1");
    set_task(2.0, "RankedInit");

//--------------------Menu----------------------
    register_menucmd(register_menuid("杀我是猪"),1023,"CheckMenuCmd");

    g_menu = menu_create("voteMenu","voteMenu_handle");

    register_clcmd("say /menu","DisplayMenu",ADMIN_CFG,"DICK");
    register_clcmd("say /vote ","functionMainVoteMenu",ADMIN_ALL,"Yun");
    register_clcmd("say /login ","functionMainLoginMenu",ADMIN_ALL,"Yun");

    register_clcmd("login_password", "HandleLoginPassword");
    register_clcmd("register_password", "HandleRegisterPassword");
    register_clcmd("confirm_password","HandleConfirmPassword");

    build_menu();
//----------------Clcmd function----------------
    register_clcmd("+powerup","Power_up_start");
    register_clcmd("-powerup","Power_up_end");
    register_clcmd("jointeam 1","hookJoint");
    register_clcmd("jointeam 2","hookJoint");
    register_clcmd("jointeam 5","hookJoint");

    register_clcmd("turbo","CheckSwitch")
    //register_clcmd("say","hook_say");
    register_clcmd("say ez","ezSpectate");
    //勾住say命令，防止玩家在比赛中使用say命令
    register_clcmd("say","onPlayerHookSay");

//--------------------Debug---------------------
    register_clcmd("say kill","set_kill");
    register_clcmd("say reset","resetall");
    register_clcmd("say stats","seekstatus");
    register_clcmd("say data","seekData");
    register_clcmd("say scoard","ResetS")

//----------------------------------------------
    register_concmd("spec_mode","hookcmd",-1);
    // register_concmd("change_class","hookClass");

    set_task(5.0,"showIconDisplay",TASK_TIMEREMAIN_LARGE,"",0,"b");

//---------------------SQL----------------------
    set_task(1.0, "DelayedSQLInit");
}

