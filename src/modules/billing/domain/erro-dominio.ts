/** Violacao de regra de negocio. Nao adianta repetir: a mensagem e descartada. */
export class ErroDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDominio';
  }
}
