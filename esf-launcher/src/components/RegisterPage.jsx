import React, { useState } from 'react';

export default function RegisterPage({ onRegisterSuccess, goToLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  const handleRegister = (e) => {
    e.preventDefault();
    if (password !== confirmPwd) return alert('两次密码不一致！');
    
    // 模拟注册成功
    alert('注册成功！请登录');
    onRegisterSuccess();
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>注册新账号</h1>
        <form onSubmit={handleRegister}>
          <div className="input-group">
            <label>账号</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>确认密码</label>
            <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary">注册</button>
        </form>
        <p className="switch-page">
          已有账号？ <span onClick={goToLogin}>返回登录</span>
        </p>
      </div>
    </div>
  );
}