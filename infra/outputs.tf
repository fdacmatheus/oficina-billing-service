output "db_endpoint" {
  description = "Endereco do RDS do billing."
  value       = aws_db_instance.billing.address
}

output "db_secret_name" {
  description = "Secret com as credenciais do banco, lido pelo pipeline."
  value       = aws_secretsmanager_secret.db.name
}

output "billing_comandos_url" {
  description = "URL da fila de entrada (SQS_BILLING_COMANDOS_URL)."
  value       = aws_sqs_queue.billing_comandos.url
}

output "billing_comandos_dlq_url" {
  description = "URL da DLQ."
  value       = aws_sqs_queue.billing_comandos_dlq.url
}

output "lab_role_arn" {
  description = "Role usada pelos nodes do EKS para acessar o SQS."
  value       = data.aws_iam_role.lab.arn
}
