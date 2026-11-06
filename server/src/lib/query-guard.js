'use strict';

/**
 * goldsrc-query 1.1.6 的 UdpSocket.reassemble() 不做长度校验：
 * 收到不足 4 字节的 UDP 包时 readInt32LE(0) 会抛 ERR_BUFFER_OUT_OF_BOUNDS，
 * 直接把整个 API 进程带走。UDP 上出现短包/乱序包是正常噪声，不该影响服务。
 *
 * 这里在启动时给原型打补丁：长度不足按「无效包」丢弃（返回 null），
 * 其余情况沿用原实现。等上游修复后可以删掉这个文件。
 */

let installed = false;

function install() {
  if (installed) return;

  let UdpSocket;
  try {
    ({ UdpSocket } = require('goldsrc-query/dist/lib/UdpSocket'));
  } catch (err) {
    console.warn('[query-guard] 无法加载 goldsrc-query UdpSocket，跳过补丁:', err.message);
    return;
  }

  const proto = UdpSocket && UdpSocket.prototype;
  if (!proto || typeof proto.reassemble !== 'function') {
    console.warn('[query-guard] UdpSocket.reassemble 不存在，跳过补丁');
    return;
  }

  const original = proto.reassemble;

  proto.reassemble = function reassemble(msg, pending) {
    if (!msg || msg.length < 4) return null;
    if (msg.readInt32LE(0) === -2 && msg.length < 9) return null;
    return original.call(this, msg, pending);
  };

  installed = true;
}

module.exports = { install };
