import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class PagarDto {
  @ApiProperty({
    description: 'Token do cartão gerado pelo SDK JS do Mercado Pago',
    example: 'fake-aprovado',
  })
  @IsString()
  @IsNotEmpty()
  cardToken!: string;

  @ApiProperty({ example: 'visa' })
  @IsString()
  @IsNotEmpty()
  paymentMethodId!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  installments!: number;

  @ApiProperty({ example: 'cliente@exemplo.com' })
  @IsEmail()
  payerEmail!: string;
}
