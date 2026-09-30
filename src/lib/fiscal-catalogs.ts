// CFDI 4.0 c_UsoCFDI. Catalog codes are stored, descriptions are presentation only.
// Source: SAT, Anexo 20, catálogo de comprobantes CFDI 4.0.
export const cfdiUses = [
  ["G01", "Adquisición de mercancías"],
  ["G02", "Devoluciones, descuentos o bonificaciones"],
  ["G03", "Gastos en general"],
  ["I01", "Construcciones"],
  ["I02", "Mobiliario y equipo de oficina por inversiones"],
  ["I03", "Equipo de transporte"],
  ["I04", "Equipo de cómputo y accesorios"],
  ["I05", "Dados, troqueles, moldes, matrices y herramental"],
  ["I06", "Comunicaciones telefónicas"],
  ["I07", "Comunicaciones satelitales"],
  ["I08", "Otra maquinaria y equipo"],
  ["D01", "Honorarios médicos, dentales y gastos hospitalarios"],
  ["D02", "Gastos médicos por incapacidad o discapacidad"],
  ["D03", "Gastos funerales"],
  ["D04", "Donativos"],
  ["D05", "Intereses reales por créditos hipotecarios"],
  ["D06", "Aportaciones voluntarias al SAR"],
  ["D07", "Primas por seguros de gastos médicos"],
  ["D08", "Gastos de transportación escolar obligatoria"],
  ["D09", "Depósitos para el ahorro y primas de planes de pensiones"],
  ["D10", "Pagos por servicios educativos"],
  ["S01", "Sin efectos fiscales"],
  ["CP01", "Pagos"],
  ["CN01", "Nómina"],
] as const;
export const paymentForms = [
  ["01", "Efectivo"],
  ["02", "Cheque nominativo"],
  ["03", "Transferencia electrónica"],
  ["04", "Tarjeta de crédito"],
  ["05", "Monedero electrónico"],
  ["06", "Dinero electrónico"],
  ["08", "Vales de despensa"],
  ["12", "Dación en pago"],
  ["13", "Pago por subrogación"],
  ["14", "Pago por consignación"],
  ["15", "Condonación"],
  ["17", "Compensación"],
  ["23", "Novación"],
  ["24", "Confusión"],
  ["25", "Remisión de deuda"],
  ["26", "Prescripción o caducidad"],
  ["27", "A satisfacción del acreedor"],
  ["28", "Tarjeta de débito"],
  ["29", "Tarjeta de servicios"],
  ["30", "Aplicación de anticipos"],
  ["31", "Intermediario pagos"],
  ["99", "Por definir"],
] as const;
export const addressFields = [
  ["street", "Calle"],
  ["exteriorNumber", "Número exterior"],
  ["interiorNumber", "Número interior (opcional)"],
  ["colony", "Colonia"],
  ["locality", "Localidad"],
  ["municipality", "Municipio / alcaldía"],
  ["state", "Estado"],
  ["country", "País (código de tres letras)"],
] as const;
export function fiscalProfileComplete(
  profile: {
    csfDocumentId?: string | null;
    street?: string | null;
    exteriorNumber?: string | null;
    colony?: string | null;
    locality?: string | null;
    municipality?: string | null;
    state?: string | null;
    country?: string | null;
  } | null,
) {
  return (
    !!profile &&
    [
      profile.csfDocumentId,
      profile.street,
      profile.exteriorNumber,
      profile.colony,
      profile.locality,
      profile.municipality,
      profile.state,
      profile.country,
    ].every(Boolean)
  );
}
