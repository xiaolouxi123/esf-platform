# ESF AMXX r14 涓€閿儴缃诧紙HLSM 鎵樼鏈嶅姟鍣級

杩滅鏈嶅姟鍣ㄧ敤鐨勬槸 **HL Server Monitor锛圚LSM锛?* 鎵樼 hlds.exe锛屼笉鏄洿鎺ョ洃鎺?hlds 杩涚▼銆? 
鏈洰褰曟妸 r14 鍖呭彂甯冨埌鍏綉锛屽苟鎻愪緵涓€鏉″懡浠ゅ畬鎴愩€屼笅杞?鈫?鏍￠獙 鈫?瀹夎 鈫?璁?HLSM 鑷姩閲嶅惎銆嶃€?
## 涓€娆℃€ф墽琛岋紙杩滅 PowerShell锛?
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr 'https://raw.githubusercontent.com/xiaolouxi123/esf-platform/dist-amxx-r14/deploy/amxx-r14/remote-install.ps1' -UseBasicParsing -OutFile $env:TEMP\esf-amxx-install.ps1; & $env:TEMP\esf-amxx-install.ps1"
```

鍏堢湅璁″垝銆佷笉鍐欐枃浠讹細

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr 'https://raw.githubusercontent.com/xiaolouxi123/esf-platform/dist-amxx-r14/deploy/amxx-r14/remote-install.ps1' -UseBasicParsing -OutFile $env:TEMP\esf-amxx-install.ps1; & $env:TEMP\esf-amxx-install.ps1 -DryRun"
```

GitHub raw 澶囩敤鍦板潃锛坖sDelivr 涓嶅彲杈炬椂锛夛細

```
https://cdn.jsdelivr.net/gh/xiaolouxi123/esf-platform@dist-amxx-r14/deploy/amxx-r14/esf-challenge-plugins-0.4.6-r14.zip
```

## 鑴氭湰鍋氫粈涔?
1. 浠庡叕缃戜笅杞?`esf-challenge-plugins-0.4.6-r14.zip`锛?1,392 B锛夈€?2. 鏍￠獙 SHA256锛歚d4ef8670e702e663b86d1da14f046d23af2bedc076cf168d2942c19f55156be4`銆?3. 瀹氫綅瀹炰緥锛氫紭鍏堢敤姝ｅ湪杩愯鐨?`hlds.exe`锛圚LSM 鍚姩锛夊弽鎺?AMXX 鐩綍锛涙壘涓嶅埌鍒欐壂鎻?`Desktop`銆乣C:\HLDS`銆乣D:\HLDS`銆乣C:\esf` 涓嬬殑 `esf\addons\amxmodx`銆?4. 璋冪敤鍖呭唴 `install-amxx.ps1`锛氬厛澶囦唤鍒?`backup-<鏃堕棿鎴?`锛屽啀鍐?4 涓?`.amxx` 骞剁櫥璁?`plugins.ini`锛屽箓绛夈€?5. 缁撴潫瀵瑰簲 `hlds.exe`锛岀敱 HLSM 鑷姩閲嶅惎锛涙渶澶氱瓑 120 绉掔‘璁ょ鍙ｆ仮澶嶃€?6. 鍏ㄩ儴鍔ㄤ綔鍐欏叆 `%TEMP%\esf-amxx-r14.log`銆?
## 甯哥敤鍙傛暟

| 鍙傛暟 | 浣滅敤 |
|---|---|
| `-DryRun` | 鍙笅杞?鏍￠獙/鎺㈡祴骞舵墦鍗拌鍒掞紝涓嶅啓涓嶉噸鍚?|
| `-NoRestart` | 鍙畨瑁咃紝涓嶇粨鏉熻繘绋?|
| `-ServerRoot "璺緞"` | 鏄惧紡鎸囧畾鏈嶅姟鍣ㄦ牴鐩綍锛屽彲浼犲涓?|
| `-AmxModxDir "璺緞"` | 鍙涓€涓樉寮?AMXX 鐩綍 |
| `-RegisterTask -TaskTime 05:30` | 娉ㄥ唽姣忔棩璁″垝浠诲姟锛堝彧鍦ㄥ寘鐗堟湰鍙樺寲鏃舵墠鍔ㄤ綔锛?|
| `-UnregisterTask` | 鍒犻櫎璁″垝浠诲姟 |
| `-Force` | 娌℃娴嬪埌 HLSM 绐楀彛鏃朵篃鎵ц閲嶅惎 |

## 鑷姩鏇存柊锛堝彲閫夛級

```powershell
& $env:TEMP\esf-amxx-install.ps1 -RegisterTask -TaskTime 05:30
```

璁″垝浠诲姟姣忓ぉ杩愯锛氭彃浠舵枃浠跺搱甯屼笌鍏綉鍖呬竴鑷存椂**闆跺啓鍏ャ€侀浂閲嶅惎**锛涗笉涓€鑷存墠瀹夎骞堕噸鍚紝閬垮厤鏃犳剰涔夌殑鎺夌嚎銆?
## 鍥炴粴

姣忎釜 AMXX 鐩綍涓嬩細鐢熸垚 `backup-<yyyyMMdd-HHmmss>\`锛? 涓棫 `.amxx`銆乣plugins.ini`锛夈€? 
鎭㈠锛氭妸澶囦唤鏂囦欢澶嶅埗鍥炲師浣嶏紝鐒跺悗鍦?HLSM 閲岄噸鍚搴旀湇鍔″櫒銆?
## 鍖呬俊鎭?
- 鍖咃細`esf-challenge-plugins-0.4.6-r14.zip`锛?1,392 B
- SHA256锛歚d4ef8670e702e663b86d1da14f046d23af2bedc076cf168d2942c19f55156be4`
- 鍐呭锛歚esf_platform_auth.amxx`銆乣esf_ranked_lock.amxx`銆乣test_ranked.amxx`銆乣esf_gamemode.amxx`銆乣install-amxx.ps1`銆乣README.txt`銆乣SHA256SUMS.txt`
- 鐗堟湰锛歵est_ranked `1.2.0-r14`锛宎uth/lock `1.2.0`

## 娉ㄦ剰

- 闇€瑕佺鐞嗗憳鏉冮檺锛堣鍙栧叾瀹冪敤鎴疯繘绋嬪懡浠よ銆佺粨鏉?hlds.exe锛夈€?- 棣栨寤鸿鍏?`-DryRun`锛岀‘璁ゆ帰娴嬪埌鐨?AMXX 鐩綍姝ｆ槸 1v1 鍜?娴嬭瘯 涓や釜瀹炰緥銆?- 濡傛灉 HLSM 娌℃湁鑷姩鎷夎捣锛岃剼鏈細鎻愮ず锛涘湪 HLSM 閲屾墜鍔ㄩ噸鍚嵆鍙€?- 鏈寘鏄?r14 鍊欓€夊寘锛欸1鈥揋4 鑷姩/闈欐€佸璁￠€氳繃锛孏6b 鐪熶汉澶氬鎴风楠屾敹浠嶄负 BLOCKED銆?
