import React, { useState, useEffect } from 'react';
import './App.css';

// 模拟后端数据（后面我们会换成真正的数据库）
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import Lobby from './components/Lobby';

function App() {
  // 核心状态：当前在哪个页面 (login | register | lobby)
  const [currentPage, setCurrentPage] = useState('login');
  // 当前登录的用户信息
  const [user, setUser] = useState(null);

  // 登录成功回调
  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setCurrentPage('lobby');
  };

  // 退出登录
  const handleLogout = () => {
    setUser(null);
    setCurrentPage('login');
  };

  return (
    <div className="app-wrapper">
      {currentPage === 'login' && (
        <LoginPage 
          onLoginSuccess={handleLoginSuccess} 
          goToRegister={() => setCurrentPage('register')} 
        />
      )}
      
      {currentPage === 'register' && (
        <RegisterPage 
          onRegisterSuccess={() => setCurrentPage('login')} 
          goToLogin={() => setCurrentPage('login')} 
        />
      )}
      
      {currentPage === 'lobby' && (
        <Lobby user={user} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;