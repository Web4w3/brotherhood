# Vercel Deployment Guide for Relay

## Your Configuration
- **Subdomain**: `mcp-proxy.web4w3.com`
- **BROTHERHOOD_SECRET**: `01fa6b07f23f61dfb79fd907da7d81777259558f44c1a03db2a170f3f49086ca`

---

## Step 1: Prepare Local Environment

### 1.1 Create `.env.local` for testing
```bash
cp .env.example .env.local
```

### 1.2 Edit `.env.local` and add your secret
```
PORT=8080
BROTHERHOOD_SECRET=01fa6b07f23f61dfb79fd907da7d81777259558f44c1a03db2a170f3f49086ca
```

### 1.3 Test locally
```bash
npm run build
npm run start:relay
```
Visit: `http://localhost:8080/healthz` — should see `{"ok":true,"rooms":0}`

---

## Step 2: Push to Git

```bash
git add vercel.json .env.example package.json package-lock.json
git commit -m "chore: add Vercel deployment config"
git push origin main
```

---

## Step 3: Deploy to Vercel

### 3.1 Connect Repository
1. Go to [vercel.com](https://vercel.com)
2. Click **Add New** → **Project**
3. Select your Git provider (GitHub/GitLab/Bitbucket)
4. Choose the `brotherhood` repository
5. Click **Import**

### 3.2 Configure Environment Variables
1. In Vercel project settings, go to **Settings** → **Environment Variables**
2. Add new variable:
   - **Name**: `BROTHERHOOD_SECRET`
   - **Value**: `01fa6b07f23f61dfb79fd907da7d81777259558f44c1a03db2a170f3f49086ca`
   - **Environments**: All (Production, Preview, Development)
3. Click **Save**

### 3.3 Deploy
1. Click **Deploy** button
2. Wait for build to complete (should take ~2-3 min)
3. Note the Vercel URL assigned (e.g., `https://brotherhood.vercel.app`)

---

## Step 4: Configure Custom Subdomain

### 4.1 Add Domain in Vercel
1. In Vercel dashboard, go to project **Settings** → **Domains**
2. Click **Add Domain**
3. Enter: `mcp-proxy.web4w3.com`
4. Select your domain registrar option

### 4.2 Update DNS Records
Vercel will show you nameservers or CNAME records to add:

**Option A: Nameserver (recommended)**
- Use Vercel's nameservers for the entire domain
- Add these at your domain registrar (web4w3.com)

**Option B: CNAME Record**
- Add CNAME: `mcp-proxy.web4w3.com` → `cname.vercel-dns.com` (Vercel will provide exact target)
- Update at your domain registrar

### 4.3 Wait for Propagation
- DNS propagation: 5 minutes to 48 hours
- Check status in Vercel Domains section
- Once verified, you'll see ✓ next to the domain

---

## Step 5: Test Deployment

### 5.1 Test Health Endpoint
```bash
curl https://mcp-proxy.web4w3.com/healthz
```
Expected: `{"ok":true,"rooms":0}`

### 5.2 Test with Bearer Token
```bash
curl -X POST https://mcp-proxy.web4w3.com/rooms/test-room/send \
  -H "Authorization: Bearer 01fa6b07f23f61dfb79fd907da7d81777259558f44c1a03db2a170f3f49086ca" \
  -H "Content-Type: application/json" \
  -d '{"from":"client1","kind":"test","to":"client2","data":{}}'
```

### 5.3 Check Vercel Logs
- Go to **Deployments** tab in Vercel
- Click latest deployment
- View **Logs** section for real-time output

---

## Step 6: Monitor & Maintain

### 6.1 Check Health Regularly
```bash
curl https://mcp-proxy.web4w3.com/healthz
```

### 6.2 View Live Logs
- Vercel dashboard → **Functions** tab
- Click `relay.js` function
- Streaming logs appear in real-time

### 6.3 Set Up Alerts (Optional)
- Vercel dashboard → **Settings** → **Notifications**
- Enable build/deployment failure alerts

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Build fails** | Check logs in Vercel; ensure `npm run build` works locally |
| **401 Unauthorized** | Verify `BROTHERHOOD_SECRET` env var matches in Vercel |
| **Domain not working** | Wait 24h for DNS propagation; check nameserver status in Vercel |
| **Port errors** | Vercel manages PORT; don't hardcode it in code |
| **Connection timeouts** | Check `/healthz` endpoint; verify logs for errors |

---

## Rollback/Redeployment

### Redeploy Latest Commit
```bash
git push origin main
# Vercel auto-deploys on push
```

### Rollback to Previous Deployment
1. Vercel dashboard → **Deployments**
2. Click desired deployment
3. Click **Redeploy** button

---

## Next Steps
- Integrate relay URL in your MCP client code
- Update any hardcoded localhost references
- Add relay endpoint to your Claude Code MCP configuration

**Your relay is now live at**: `https://mcp-proxy.web4w3.com`
