# ennui-agents-core on Kubernetes

## Prerequisites

- Docker image built from repo root: `docker build -t ennui-agents-core:latest -f ennui-agents-core/Dockerfile .`
- Cluster with kubectl configured.

## ConfigMap

Create the ConfigMap from the agents config (from repo root):

```bash
kubectl create configmap ennui-agents-config --from-file=agents=agents --dry-run=client -o yaml > ennui-agents-core/k8s/configmap-agents.yaml
kubectl apply -f ennui-agents-core/k8s/configmap-agents.yaml
```

## Secret (optional)

Copy `secret.example.yaml` to `secret.yaml`, fill API keys and optional ENNUI_API_KEY, then:

```bash
kubectl apply -f ennui-agents-core/k8s/secret.yaml
```

Do not commit `secret.yaml`.

## Deploy

```bash
kubectl apply -f ennui-agents-core/k8s/deployment.yaml
kubectl apply -f ennui-agents-core/k8s/service.yaml
```

Optional Ingress: edit `ingress.yaml` (host, TLS), then `kubectl apply -f ennui-agents-core/k8s/ingress.yaml`.

## Image

For a real registry: tag and push the image, then set `image` in deployment.yaml (e.g. `your-registry/ennui-agents-core:latest`).
