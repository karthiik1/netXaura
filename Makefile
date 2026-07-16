.PHONY: check backend-test frontend-check up

check: backend-test frontend-check

backend-test:
	cd backend && ruff check app tests && black --check app tests && pytest -q

frontend-check:
	cd frontend && npm run typecheck && npm test && npm run build

up:
	docker compose up --build
