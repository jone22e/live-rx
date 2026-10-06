# Operação no servidor (Docker). Em desenvolvimento use `npm run dev`.
.PHONY: up update down restart logs status health

## Sobe (ou recria) os containers construindo as imagens
up:
	docker compose up -d --build

## Atualiza o código (git pull) e recria os containers com as imagens novas
update:
	git pull --ff-only
	docker compose up -d --build
	docker compose ps
	@sleep 3 && $(MAKE) --no-print-directory health

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f --tail=200

status:
	docker compose ps

## Confere o backend pela porta publicada (WEB_PORT do .env, padrão 3012)
health:
	@port=$$(grep -E '^WEB_PORT=' .env 2>/dev/null | cut -d= -f2); curl -sf "http://127.0.0.1:$${port:-3012}/health" && echo || (echo "health falhou" && exit 1)
