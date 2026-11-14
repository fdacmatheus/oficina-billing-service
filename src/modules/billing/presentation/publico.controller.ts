import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import { OrcamentosService } from '../application/orcamentos.service';
import { PagamentosService } from '../application/pagamentos.service';
import { PagarDto } from './dto/pagar.dto';
import { ConfigPagamento, renderizarCheckout, renderizarErro } from './checkout/pagina';
import { apresentarConsultaPublica, apresentarOrcamento, apresentarPagamento } from './presenters';

/** Rotas do link enviado ao cliente. Sem JWT: a protecao e o token do orcamento. */
@ApiTags('publico')
@ApiQuery({ name: 'token', required: true })
@Controller('publico/orcamentos')
export class PublicoController {
  private readonly logger = new Logger(PublicoController.name);
  private readonly configPagamento: ConfigPagamento;

  constructor(
    private readonly orcamentos: OrcamentosService,
    private readonly pagamentos: PagamentosService,
    config: ConfigService,
  ) {
    this.configPagamento = {
      modo: config.get<string>('MP_MODO', 'fake') === 'mercadopago' ? 'mercadopago' : 'fake',
      publicKey: config.get<string>('MP_PUBLIC_KEY') || undefined,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do orçamento e andamento do pagamento' })
  async consultar(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string) {
    return apresentarConsultaPublica(await this.orcamentos.consultarPublico(id, token));
  }

  @Get(':id/checkout')
  @ApiProduces('text/html')
  @ApiOperation({ summary: 'Página do cliente: revisar, aprovar e pagar o orçamento (HTML)' })
  async checkout(@Param('id') id: string, @Query('token') token: string, @Res() res: Response) {
    // O token vai na URL: sem Referer, ele nao vaza para o SDK do Mercado Pago.
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    try {
      if (!isUUID(id)) throw new NotFoundException();
      const consulta = await this.orcamentos.consultarPublico(id, token);
      res.send(renderizarCheckout(apresentarConsultaPublica(consulta), this.configPagamento));
    } catch (erro) {
      const status = erro instanceof HttpException ? erro.getStatus() : 500;
      if (status >= 500) this.logger.error(`Falha ao montar o checkout ${id}`, String(erro));
      res.status(status).send(renderizarErro(status));
    }
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cliente aprova o orçamento' })
  async aprovar(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string) {
    return apresentarOrcamento(await this.orcamentos.aprovar(id, token));
  }

  @Post(':id/recusar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cliente recusa o orçamento' })
  async recusar(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string) {
    return apresentarOrcamento(await this.orcamentos.recusar(id, token));
  }

  @Post(':id/pagar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paga com cartão tokenizado (checkout transparente)' })
  async pagar(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string,
    @Body() dto: PagarDto,
  ) {
    return apresentarPagamento(await this.pagamentos.pagar(id, token, dto));
  }
}
