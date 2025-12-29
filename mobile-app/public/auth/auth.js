document.addEventListener('DOMContentLoaded', () => {
    // --- KHAI BÁO BIẾN ---
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    // Kiểm tra nếu đã đăng nhập thì đá về trang chính luôn
    if (localStorage.getItem('isLoggedIn') === 'true') {
        window.location.href = '../index.html';
        return;
    }

    // --- CHUYỂN TAB ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            forms.forEach(f => f.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.target).classList.add('active');
        });
    });

    // --- HIỆN/ẨN MẬT KHẨU ---
    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.addEventListener('click', () => {
            const input = icon.previousElementSibling;
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    // --- REGEX ---
    const isGmail = (email) => /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email);
    const passReqs = {
        length: (p) => p.length >= 8,
        upper: (p) => /[A-Z]/.test(p),
        number: (p) => /\d/.test(p),
        special: (p) => /[@$!%*?&.]/.test(p)
    };

    // --- VALIDATE PASSWORD REAL-TIME ---
    const regPass = document.getElementById('reg-password');
    if (regPass) {
        regPass.addEventListener('input', (e) => {
            const val = e.target.value;
            const setStatus = (id, isValid) => {
                const el = document.getElementById(id);
                if (isValid) el.classList.add('valid');
                else el.classList.remove('valid');
            };

            setStatus('req-len', passReqs.length(val));
            setStatus('req-upper', passReqs.upper(val));
            setStatus('req-num', passReqs.number(val));
            setStatus('req-spec', passReqs.special(val));
        });
    }

    // --- HÀM TẠO ID NGẪU NHIÊN ---
    const generateIdTag = () => {
        // Tạo chuỗi Hex ngẫu nhiên, ví dụ: "A1B2C3D4"
        const hex = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase();
        return hex.padStart(8, '0');
    }

    // --- XỬ LÝ ĐĂNG KÝ ---
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const ln = document.getElementById('reg-lastname').value.trim();
        const fn = document.getElementById('reg-firstname').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pass = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm').value;

        if (!ln || !fn) return alert("Vui lòng nhập họ tên.");
        if (!isGmail(email)) return alert("Email phải có đuôi @gmail.com");
        
        // Kiểm tra lại password lần cuối
        if (!passReqs.length(pass) || !passReqs.upper(pass) || 
            !passReqs.number(pass) || !passReqs.special(pass)) {
            return alert("Mật khẩu không đủ mạnh (Cần: 8+ ký tự, Hoa, Số, Ký tự đặc biệt).");
        }

        if (pass !== confirm) return alert("Mật khẩu xác nhận không khớp.");

        // Kiểm tra tồn tại
        const users = JSON.parse(localStorage.getItem('ev_users') || '[]');
        if (users.find(u => u.email === email)) {
            return alert("Gmail này đã được đăng ký!");
        }

        const newIdTag = generateIdTag();

        users.push({ 
            firstname: fn, 
            lastname: ln, 
            email: email, 
            password: pass,
            idTag: newIdTag 
        });
        localStorage.setItem('ev_users', JSON.stringify(users));
        
        alert("Đăng ký thành công! Vui lòng đăng nhập.");
        tabs[0].click(); 
        document.getElementById('login-email').value = email;
    });

    // --- XỬ LÝ ĐĂNG NHẬP ---
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const pass = document.getElementById('login-password').value;

        if (!isGmail(email)) return alert("Vui lòng nhập đúng Gmail.");

        const users = JSON.parse(localStorage.getItem('ev_users') || '[]');
        const user = users.find(u => u.email === email && u.password === pass);

        if (user) {
            // Lưu trạng thái đăng nhập
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('currentUser', JSON.stringify(user));
            
            // CHUYỂN HƯỚNG VỀ APP CHÍNH
            window.location.href = '../index.html';
        } else {
            alert("Email hoặc mật khẩu không chính xác.");
        }
    });
});