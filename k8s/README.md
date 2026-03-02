# core on Kubernetes

## Prerequisites

- Docker image built from this module: `docker build -t core:latest -f Dockerfile .`
- Cluster with kubectl configured.

## Agent config source

The deployment uses the agent configs baked into the Docker image (`/app/config/agents`).

If you need runtime overrides, mount your own volume/path and set `CONFIG_DIR` accordingly.

## Secret (optional)

Copy `secret.example.yaml` to `secret.yaml`, fill API keys and optional CORE_API_KEY, then:

```bash
kubectl apply -f k8s/secret.yaml
```

Do not commit `secret.yaml`.

## Deploy

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

Optional Ingress: edit `ingress.yaml` (host, TLS), then `kubectl apply -f k8s/ingress.yaml`.

## Image

For a real registry: tag and push the image, then set `image` in deployment.yaml (e.g. `your-registry/core:latest`).
