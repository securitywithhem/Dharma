# Dharma – Self-Hosted Compliance Platform

**Welcome to Dharma!** If you are new here, don't worry—this guide is written so anyone can understand exactly what this project is and how it works.

---

## 🤔 ELI5: What is this project?
Imagine you run a company, and you need to prove to your clients and the government that you keep their data safe. To do this, you have to follow big rulebooks (called compliance frameworks) like **SOC 2**, **ISO 27001**, or the **DPDP Act**.

Proving you follow the rules usually means reading hundreds of pages, taking screenshots of your computer settings, and paying expensive consultants. **Dharma is a software that does this for you automatically.** 
You upload your evidence (like a screenshot or a log file), and Dharma uses Artificial Intelligence (AI) to read it, understand it, and check off the exact rules you satisfied—all without sending your secret company data to the public cloud.

---

## 🎯 What problem does it solve?

1. **Keeping Data Secret (Data Sovereignty):** Usually, AI tools require you to send your data to servers owned by OpenAI or Google. Dharma runs the AI *locally* on your own computer or private server. Your data never leaves your building.
2. **Saving Time (Automated Mapping):** Instead of manually reading a rulebook to figure out where a piece of evidence fits, Dharma's AI reads the evidence and instantly recommends the rules it satisfies.
3. **Saving Money (Zero Cloud Costs):** Because you run Dharma yourself, you don't pay monthly subscriptions to expensive compliance software, and you don't pay per-word for AI processing.
4. **Writing Policies:** Need a privacy policy? Dharma reads the actual law (like the DPDP Act) and writes a custom policy for your company using its local AI.
5. **Tamper-Proof Logs:** If someone tries to cheat the system and delete a log, Dharma's database uses a blockchain-like chain. If one piece is altered, the chain breaks, and everyone knows it was tampered with.

---

## 🚶 App Flow: How do you use it?

Here is the typical journey of a user using Dharma:

1. **Sign In:** You log into the app using a secure, passwordless magic link sent to your email.
2. **Pick a Rulebook (Framework):** You select which rules you want to comply with (e.g., ISO 27001).
3. **Upload Evidence:** You upload a file (e.g., a PDF of your employee handbook or a screenshot of your firewall settings).
4. **AI Magic:** In the background, Dharma extracts the text from your file, asks the local AI to understand it, and matches it against the rulebook.
5. **Review & Approve:** You see a recommendation: *"This firewall screenshot satisfies Control 4.1: Network Security."* You click "Approve".
6. **Generate Reports:** When an external auditor asks for proof, you generate a secure, temporary link. The auditor logs in, views your evidence, and gives you your certification!

---

## 🏗️ Architecture: How is it built?

Dharma is made up of several moving parts that talk to each other:
- **Next.js (The Brain & Face):** This displays the website you click on and handles the logic.
- **Postgres + pgvector (The Memory):** A database that remembers your settings, your logs, and mathematically stores "meanings" of text (embeddings) so the AI can search through them.
- **MinIO (The Filing Cabinet):** A place to securely store the actual files and PDFs you upload.
- **BullMQ + Redis (The Worker):** When you ask the AI to read a 50-page PDF, this handles the heavy lifting in the background so your website doesn't freeze.
- **Ollama (The AI Engine):** The local AI that reads text and writes policies, running completely offline.

---

## 🛠️ Step-by-Step Setup Guide

Follow these steps to run Dharma on your own machine. 

### Prerequisites
*   [Git](https://git-scm.com/) installed
*   [Docker & Docker Compose](https://www.docker.com/) installed and running
*   [Node.js](https://nodejs.org/) (Version >= 18.18.0)

### 1. Clone the Code
Download the code to your computer:
```bash
git clone https://github.com/securitywithhem/Dharma.git
cd Dharma
```

### 2. Configure Environment Variables
We store configuration (like passwords and ports) in a folder called `envs/`.
*(Note: If you are setting this up for the first time and the files don't exist yet, you can copy them from an example file, but they are already organized in the `envs/` folder in this repo!)*

### 3. Spin Up the Services (Docker)
The easiest way to run everything is using Docker, which starts the database, AI, and website all at once:
```bash
# Our package.json script automatically points to the envs/.env.docker file!
npm run docker:up
```

### 4. Initialize and Seed the Database
We need to setup the initial rulebooks and tables in the database:
```bash
docker exec dharma-nextjs npm run seed:all
```
*(This sets up the cryptographic log chain and inserts the default compliance controls).*

### 5. Access the Web App & Sign In
Open your web browser (like Google Chrome) and go to:
*   **Application Link:** [http://localhost:3000](http://localhost:3000)

**How to Sign In (Local Testing):**
1. Enter an email (e.g., `admin@dharma.local`) on the sign-in screen and click **Sign In**.
2. Look at your terminal logs to find the "magic link":
   ```bash
   npm run docker:logs
   ```
3. Copy the link that looks like `http://localhost:3000/api/auth/callback/email?...`, paste it into your browser, and you are logged in!

---

## 🗄️ Backup & Restore

Because you host this yourself, you are in charge of backups! Dharma makes this easy:
- **Automated Backups:** Every night at 2:00 AM, the system automatically saves your database and your files to a local folder.
- **Manual Backups:** You can force a backup right now by running:
  ```bash
  docker exec dharma-backup-scheduler /scripts/backup-all.sh
  ```

## 📊 Monitoring (Advanced)
Want to see how much CPU or memory the app is using? You can start the monitoring dashboard:
```bash
docker compose --env-file envs/.env.docker --profile monitoring up -d
```
Then visit [http://localhost:3001](http://localhost:3001) to see beautiful graphs of your system's health.
