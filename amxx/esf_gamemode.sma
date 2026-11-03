/**
 * ESF Gamemode Guard
 *
 * 启动器在拉起 hl.exe 前会写 game.cfg：
 *   mp_gamemode         "0" 混战 / "2" 组队
 *   esf_force_gamemode  "0" / "2"
 *
 * 本插件在 amxx 配置加载后再次应用一次，避免 game.cfg / 服务器配置的顺序问题。
 * 它不负责比赛中切换地图；模式切换在启动前完成。
 */

#include <amxmodx>

#define PLUGIN  "ESF Gamemode Guard"
#define VERSION "1.0.0"
#define AUTHOR  "ESF Platform"

new g_pcForce;

public plugin_init() {
    register_plugin(PLUGIN, VERSION, AUTHOR);
    g_pcForce = register_cvar("esf_force_gamemode", "-1");
    set_task(1.0, "applyMode");
    set_task(4.0, "applyMode");
}

public applyMode() {
    new mode = get_pcvar_num(g_pcForce);
    if (mode != 0 && mode != 2) return;

    new current = get_cvar_num("mp_gamemode");
    if (current == mode) return;

    set_cvar_num("mp_gamemode", mode);
    server_cmd("mp_gamemode %d", mode);
    server_exec();
    log_amx("[gamemode] force mp_gamemode=%d (was %d)", mode, current);
}
