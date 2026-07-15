variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for resources"
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "cluster_name" {
  type        = string
  default     = "dharma-cluster"
  description = "EKS cluster name"
}

variable "kubernetes_version" {
  type        = string
  default     = "1.29"
  description = "Kubernetes version"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "enable_monitoring" {
  type        = bool
  default     = true
  description = "Deploy kube-prometheus-stack"
}

variable "enable_logging" {
  type        = bool
  default     = true
  description = "Deploy Loki logging stack"
}

variable "monitoring_chart_version" {
  type        = string
  default     = "65.1.1"
  description = "kube-prometheus-stack chart version"
}

variable "logging_chart_version" {
  type        = string
  default     = "2.10.2"
  description = "loki-stack chart version"
}

variable "grafana_admin_password" {
  type        = string
  sensitive   = true
  description = "Grafana admin password (set via TF_VAR_grafana_admin_password)"
}
