locals {
  name = var.cluster_name
  tags = {
    Environment = var.environment
    Project     = "dharma"
  }
}

# ── Networking (community module) ──
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "${local.name}-vpc"
  cidr = var.vpc_cidr

  azs             = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets = [for k in range(3) : cidrsubnet(var.vpc_cidr, 4, k)]
  public_subnets  = [for k in range(3) : cidrsubnet(var.vpc_cidr, 8, k + 48)]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment != "prod"
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }

  tags = local.tags
}

# ── EKS cluster (community module) ──
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = local.name
  cluster_version = var.kubernetes_version

  cluster_endpoint_public_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    app = {
      min_size       = 3
      max_size       = 10
      desired_size   = 3
      instance_types = ["t3.xlarge"]
      disk_size      = 100
    }
    workers = {
      min_size       = 2
      max_size       = 8
      desired_size   = 2
      instance_types = ["t3.large"]
      disk_size      = 50
    }
  }

  tags = local.tags
}

# ── Monitoring: kube-prometheus-stack ──
resource "helm_release" "monitoring" {
  count            = var.enable_monitoring ? 1 : 0
  name             = "kube-prometheus-stack"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  version          = var.monitoring_chart_version
  namespace        = "monitoring"
  create_namespace = true

  set_sensitive {
    name  = "grafana.adminPassword"
    value = var.grafana_admin_password
  }

  depends_on = [module.eks]
}

# ── Logging: Loki stack ──
resource "helm_release" "logging" {
  count            = var.enable_logging ? 1 : 0
  name             = "loki"
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "loki-stack"
  version          = var.logging_chart_version
  namespace        = "logging"
  create_namespace = true

  depends_on = [module.eks]
}

# ── Dharma application (local chart at ../helm/dharma) ──
resource "helm_release" "dharma" {
  name             = "dharma"
  chart            = "${path.module}/../helm/dharma"
  namespace        = "dharma-prod"
  create_namespace = true

  values = [file("${path.module}/helm-values-${var.environment}.yaml")]

  depends_on = [
    module.eks,
    helm_release.monitoring,
    helm_release.logging,
  ]
}
