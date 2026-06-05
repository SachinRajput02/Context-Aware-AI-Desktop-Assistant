# Makefile — AI Desktop Assistant
# One-command shortcuts for common tasks

.PHONY: install dev test deploy clean

# ─── Install all dependencies ─────────────────────────────────────────────────

install:
	@echo "📦 Installing backend dependencies..."
	cd backend && npm install
	@echo "📦 Installing Electron app dependencies..."
	cd electron-app && npm install
	@echo "✅ All dependencies installed."

# ─── Development ──────────────────────────────────────────────────────────────

dev:
	@echo "🚀 Starting development servers..."
	@echo "   Backend: http://localhost:3001"
	@echo "   Use Ctrl+C to stop both"
	npx concurrently \
		"cd backend && npm run dev" \
		"cd electron-app && npm start" \
		--names "backend,electron" \
		--prefix-colors "blue,green"

dev-backend:
	cd backend && npm run dev

dev-electron:
	cd electron-app && npm start

# ─── AWS Setup ────────────────────────────────────────────────────────────────

aws-setup:
	@echo "☁️  Setting up AWS resources..."
	cd backend && npm run aws:setup

# ─── Testing ──────────────────────────────────────────────────────────────────

test:
	@echo "🧪 Running backend tests..."
	cd backend && npm test

test-watch:
	cd backend && npm test -- --watch

test-coverage:
	cd backend && npm test -- --coverage

# ─── Deployment ───────────────────────────────────────────────────────────────

deploy:
	@echo "🚀 Deploying to AWS..."
	cd backend && npm run deploy
	@echo "✅ Deployed! Update electron-app/.env with your API Gateway URL."

deploy-prod:
	cd backend && npm run deploy:prod

# ─── Build Electron App ───────────────────────────────────────────────────────

build-app:
	@echo "📦 Building Electron app..."
	cd electron-app && npm run build
	@echo "✅ App built in electron-app/out/"

# ─── Environment Setup ────────────────────────────────────────────────────────

setup-env:
	@[ -f backend/.env ] || (cp backend/.env.example backend/.env && echo "Created backend/.env — add your API keys")
	@[ -f electron-app/.env ] || (cp electron-app/.env.example electron-app/.env && echo "Created electron-app/.env")

# ─── Clean ────────────────────────────────────────────────────────────────────

clean:
	rm -rf backend/dist
	rm -rf backend/node_modules
	rm -rf electron-app/dist
	rm -rf electron-app/node_modules
	rm -rf electron-app/out
	@echo "✅ Cleaned all build artifacts and node_modules."

# ─── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "AI Desktop Assistant — Available commands:"
	@echo ""
	@echo "  make install       Install all npm dependencies"
	@echo "  make setup-env     Create .env files from examples"
	@echo "  make aws-setup     Create DynamoDB tables and S3 bucket"
	@echo "  make dev           Start backend + Electron in parallel"
	@echo "  make dev-backend   Start backend only"
	@echo "  make dev-electron  Start Electron app only"
	@echo "  make test          Run all tests"
	@echo "  make test-coverage Run tests with coverage report"
	@echo "  make deploy        Deploy backend to AWS Lambda"
	@echo "  make build-app     Build distributable Electron app"
	@echo "  make clean         Remove all build artifacts"
	@echo ""
