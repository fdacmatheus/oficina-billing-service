import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { PagamentosService } from '../application/pagamentos.service';
import { assinaturaValida } from '../infrastructure/gateway/assinatura-mercadopago';

interface NotificacaoMercadoPago {
  type?: string;
  action?: string;
  data?: { id?: string };
}

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  private readonly segredo?: string;

  constructor(
    private readonly pagamentos: PagamentosService,
    config: ConfigService,
  ) {
    this.segredo = config.get<string>('MP_WEBHOOK_SECRET') || undefined;
  }

  @Post('mercadopago')
  @HttpCode(200)
  async mercadopago(
    @Headers('x-signature') assinatura: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Query('data.id') dataIdQuery: string | undefined,
    @Query('type') tipoQuery: string | undefined,
    @Body() corpo: NotificacaoMercadoPago,
  ) {
    const dataId = dataIdQuery ?? corpo?.data?.id;
    // Sem segredo configurado nao ha como confiar na origem: rejeita tudo.
    if (!assinaturaValida({ assinatura, requestId, dataId, segredo: this.segredo })) {
      throw new UnauthorizedException('Assinatura do webhook inválida');
    }
    const tipo = tipoQuery ?? corpo?.type;
    if (tipo !== 'order' || !dataId) return { recebido: true, ignorado: true };

    const pagamento = await this.pagamentos.reconciliar(dataId);
    return { recebido: true, status: pagamento?.status ?? null };
  }
}
