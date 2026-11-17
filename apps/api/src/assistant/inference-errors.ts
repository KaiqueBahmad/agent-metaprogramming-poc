import {
  HttpException,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";

const logger = new Logger("AssistantInference");

function safeDetail(message: string) {
  let value = message;
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /KEY|SECRET|TOKEN|PASSWORD/i.test(name))
      value = value.split(secret).join("[redigido]");
  }
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redigido]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redigido]")
    .slice(0, 800);
}

export function inferenceFailure(
  error: unknown,
  provider: string
): HttpException {
  if (error instanceof HttpException) return error;
  const failure = error as {
    name?: string;
    code?: string;
    message?: string;
    $metadata?: { requestId?: string; httpStatusCode?: number };
    cause?: { code?: string };
  } | null;
  const name = failure?.name || "Error";
  const code = failure?.code || failure?.cause?.code;
  let message: string;
  if (
    [
      "UnrecognizedClientException",
      "InvalidClientTokenId",
      "InvalidSignatureException",
      "SignatureDoesNotMatch"
    ].includes(name)
  ) {
    message =
      "A AWS recusou as credenciais: token de segurança inválido. Confira AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY. Se forem credenciais temporárias, preencha também AWS_SESSION_TOKEN.";
  } else if (
    ["ExpiredTokenException", "ExpiredToken", "TokenRefreshRequired"].includes(
      name
    )
  ) {
    message =
      "As credenciais AWS expiraram. Renove a sessão ou as credenciais e reinicie a API.";
  } else if (
    ["CredentialsProviderError", "TokenProviderError"].includes(name)
  ) {
    message =
      "Não foi possível obter credenciais AWS. Configure as chaves, um AWS_PROFILE válido ou a IAM role do ambiente.";
  } else if (name === "AccessDeniedException") {
    message =
      "A AWS negou acesso ao modelo. Verifique as permissões IAM, o acesso ao modelo/perfil e a região configurada.";
  } else if (name === "ResourceNotFoundException") {
    message =
      "Modelo ou perfil de inferência não encontrado no Bedrock. Confira ASSISTANT_MODEL e AWS_REGION.";
  } else if (name === "ValidationException") {
    message = `O Bedrock rejeitou a configuração ou a chamada: ${safeDetail(failure?.message || "Verifique o modelo e os parâmetros.")}`;
  } else if (
    [
      "ThrottlingException",
      "ServiceQuotaExceededException",
      "RateLimitError"
    ].includes(name)
  ) {
    message =
      "O provedor atingiu o limite de solicitações ou de uso. Aguarde e confira a quota do modelo.";
  } else if (
    [
      "AbortError",
      "TimeoutError",
      "ModelTimeoutException",
      "APIConnectionTimeoutError"
    ].includes(name)
  ) {
    message = "O modelo excedeu o tempo limite de resposta. Tente novamente.";
  } else if (name === "AuthenticationError") {
    message = "O provedor recusou a chave da API. Confira ASSISTANT_API_KEY.";
  } else if (
    [
      "EAI_AGAIN",
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ERR_HTTP2_STREAM_CANCEL"
    ].includes(code || "") ||
    name === "APIConnectionError"
  ) {
    message =
      "Não foi possível conectar ao provedor do modelo. Confira a rede e o endpoint configurado.";
  } else {
    message =
      "Não foi possível obter uma resposta do modelo. Consulte o diagnóstico da inferência no servidor.";
  }
  // Sem objeto de erro, stack, prompt ou headers: podem conter credenciais.
  logger.error(
    JSON.stringify({
      provider,
      error: name,
      code,
      requestId: failure?.$metadata?.requestId,
      httpStatus: failure?.$metadata?.httpStatusCode,
      diagnostic: message
    })
  );
  return new ServiceUnavailableException(message);
}
