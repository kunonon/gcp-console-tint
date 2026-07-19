.PHONY: up down export

# Start the dev stack in the background (WXT dev server with HMR on port 3000).
# Follow logs with: docker compose logs -f dev
up:
	docker compose up -d

# Stop the dev stack.
down:
	docker compose down

# Build a production Chrome zip (Web Store submittable) into .output/.
# One-shot container, so it works whether or not the dev stack is running.
export:
	docker compose run --rm dev sh -c "corepack enable && pnpm install && pnpm zip"
	@ls -t .output/*.zip | head -1
