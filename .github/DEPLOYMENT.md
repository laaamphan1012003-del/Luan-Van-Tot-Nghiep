# GitHub Actions Deployment Setup

This document explains how to set up automated deployment to your VPS using GitHub Actions.

## Required GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

### SSH Connection Secrets

1. **SSH_PRIVATE_KEY**
   ```bash
   # On your local machine, copy your private key:
   cat ~/.ssh/id_rsa
   # Or generate a new key pair specifically for deployment:
   ssh-keygen -t rsa -b 4096 -C "github-actions-deploy" -f ~/.ssh/github_deploy
   cat ~/.ssh/github_deploy
   ```
   Paste the entire private key content (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`)

2. **SSH_HOST**
   ```
   # Your VPS IP address or hostname
   Example: 192.168.1.100
   ```

3. **SSH_USER**
   ```
   # SSH username for VPS
   Example: ubuntu
   ```

4. **SSH_PORT** (optional, defaults to 22)
   ```
   # SSH port if not default
   Example: 22
   ```

5. **DEPLOY_PATH** (optional)
   ```
   # Deployment directory on VPS
   Example: /home/ubuntu/ocpp-csms
   # If not set, defaults to: $HOME/ocpp-csms
   ```

### Database Secrets

6. **MYSQL_ROOT_PASSWORD**
   ```
   # MySQL root password
   Example: YourSecureRootPassword123!
   ```

7. **MYSQL_DATABASE**
   ```
   # Database name
   Example: ocpp_csms
   ```

8. **MYSQL_USER**
   ```
   # MySQL user for application
   Example: ocpp_user
   ```

9. **MYSQL_PASSWORD**
   ```
   # MySQL user password
   Example: YourSecurePassword123!
   ```

## VPS Preparation

### 1. Add GitHub Actions SSH Key to VPS

```bash
# On your local machine, copy the public key:
cat ~/.ssh/github_deploy.pub  # or ~/.ssh/id_rsa.pub

# SSH to your VPS:
ssh your-user@your-vps

# Add the public key to authorized_keys:
mkdir -p ~/.ssh
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 2. Ensure VPS Can Clone Repository

For **public repositories**: No additional setup needed.

For **private repositories**: Add a deploy key
```bash
# On VPS, generate a deploy key:
ssh-keygen -t rsa -b 4096 -f ~/.ssh/github_deploy_key

# Add the public key to GitHub:
cat ~/.ssh/github_deploy_key.pub
# Go to: Repository → Settings → Deploy keys → Add deploy key
```

## How the Deployment Works

1. **Trigger**: Pushes to `main` branch or manual workflow dispatch
2. **Build**: GitHub Actions checks out code
3. **Deploy**: 
   - Connects to VPS via SSH
   - Installs Docker and Docker Compose (if needed)
   - Clones/updates repository
   - Creates `.env` file with secrets
   - Stops old containers
   - Builds and starts new containers
4. **Verify**: Checks container health
5. **Complete**: Application accessible at `http://YOUR_VPS:9000`

## Workflow File Location

`.github/workflows/deploy.yml`

## Manual Deployment Trigger

Go to: Actions → Deploy to VPS → Run workflow → Run workflow on main

## Monitoring Deployment

1. **GitHub Actions**: Repository → Actions tab
2. **VPS Logs**: 
   ```bash
   ssh your-vps
   cd ~/ocpp-csms  # or your DEPLOY_PATH
   docker compose logs -f
   ```

## Troubleshooting

### Deployment Fails - SSH Connection

- Verify SSH_PRIVATE_KEY is correct (include header/footer)
- Check SSH_HOST and SSH_PORT are correct
- Ensure VPS allows SSH connections from GitHub IPs

### Deployment Fails - Docker Issues

- Check VPS has enough disk space: `df -h`
- Check VPS has enough memory: `free -h`
- Manually SSH and run: `docker compose up -d`

### Application Not Accessible

1. Check firewall allows port 9000:
   ```bash
   sudo ufw status
   sudo ufw allow 9000/tcp
   ```

2. Check containers are running:
   ```bash
   cd ~/ocpp-csms
   docker compose ps
   docker compose logs app
   ```

## Security Recommendations

1. ✅ Use strong passwords for database secrets
2. ✅ Use dedicated SSH key for deployment (not your personal key)
3. ✅ Restrict SSH access to VPS (use SSH keys only, disable password auth)
4. ✅ Keep VPS updated: `sudo apt update && sudo apt upgrade`
5. ✅ Use firewall to restrict access to only necessary ports

## Updating Secrets

After changing secrets in GitHub:
1. Go to Actions → Deploy to VPS → Re-run failed jobs
2. Or push a new commit to trigger deployment

## Rollback

To rollback to a previous version:
```bash
ssh your-vps
cd ~/ocpp-csms
git log --oneline  # Find commit hash
git reset --hard COMMIT_HASH
docker compose up -d --build
```
