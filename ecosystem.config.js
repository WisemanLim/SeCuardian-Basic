/**
 * pm2 ecosystem config — local 비Docker 모드 (make local-all)
 * 사용: pm2 start ecosystem.config.js --env local
 * 로그: make local-logs  (= pm2 logs)
 * 포트: BACKEND_PORT / FRONTEND_PORT 환경변수로 주입 (Makefile이 .env.local 에서 읽어 전달)
 */
const BACKEND_PORT = process.env.BACKEND_PORT || "8200";
const FRONTEND_PORT = process.env.FRONTEND_PORT || "4200";

module.exports = {
  apps: [
    {
      name: "SeCuardian-api",
      script: "uv",
      args: `run uvicorn app.main:app --port ${BACKEND_PORT}`,
      cwd: "./",
      out_file: "logs/api.out.log",
      error_file: "logs/api.err.log",
      time: true,
      watch: false,
      env_local: {
        ENV: "local",
      },
    },
    {
      name: "SeCuardian-fe",
      script: "pnpm",
      args: `dev --port ${FRONTEND_PORT}`,
      cwd: "./front",
      out_file: "../logs/fe.out.log",
      error_file: "../logs/fe.err.log",
      time: true,
      watch: false,
      env_local: {
        VITE_API_URL: `http://localhost:${BACKEND_PORT}`,
        CI: "true",
      },
    },
  ],
};
