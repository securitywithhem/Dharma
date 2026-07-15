output "cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name"
}

output "cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS API server endpoint"
}

output "region" {
  value       = var.aws_region
  description = "AWS region"
}

output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPC id"
}

output "configure_kubectl" {
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
  description = "Command to configure kubectl for this cluster"
}
