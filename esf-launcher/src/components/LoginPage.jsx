import React, { useState } from 'react';

export default function LoginPage({ onLoginSuccess, goToRegister }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) return setError('请输入账号和密码');

    // 🚀 这里暂时用模拟的本地验证，后面我们会换成真正的 IPC 通信
    // 假装发送给后端验证
    if (username === 'admin' && password === '123456') {
      onLoginSuccess({ username: 'admin', role: 'GM' });
    } else {
      setError('账号或密码错误（试试 admin / 123456）');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>ESF 平台登录</h1>
        {error && <p className="error-msg">{error}</p>}
        
        <form onSubmit={handleLogin}>
          <div className="input-group">
            <label>账号</label>
            <input 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              placeholder="请输入用户名"
            />
          </div>
          <div className="input-group">
            <label>密码</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="请输入密码"
            />
          </div>
          <button type="submit" className="btn-primary">进入大厅</button>
          {/* 🚀 新增：免登录测试按钮 */}
        <button 
          type="button" 
          className="btn-test-login" 
          onClick={() => onLoginSuccess({ username: '测试管理员', role: 'GM' })}
        >
          一键测试登录 (免密码)
        </button>

        </form>
        
        <p className="switch-page">
          还没有账号？ <span onClick={goToRegister}>立即注册</span>
        </p>
      </div>
    </div>
  );
}