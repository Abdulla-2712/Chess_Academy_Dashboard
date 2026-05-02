// Auth logic for login and register pages
document.addEventListener('DOMContentLoaded', () => {
  // If already logged in, redirect to dashboard
  if (API.isLoggedIn()) {
    window.location.href = '/index.html';
    return;
  }

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Signing in...';

      try {
        const data = await API.post('/auth/login', {
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        });

        API.setToken(data.token);
        API.setCoach(data.coach);
        window.location.href = '/index.html';
      } catch (err) {
        showAlert('alert', err.message);
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('register-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Creating account...';

      try {
        const data = await API.post('/auth/register', {
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        });

        API.setToken(data.token);
        API.setCoach(data.coach);
        window.location.href = '/index.html';
      } catch (err) {
        showAlert('alert', err.message);
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    });
  }
});
