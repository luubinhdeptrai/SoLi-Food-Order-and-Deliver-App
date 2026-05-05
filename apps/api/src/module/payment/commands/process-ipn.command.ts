/**
 * ProcessIpnCommand
 *
 * Dispatched by PaymentController when VNPay calls the IPN endpoint.
 * The raw query params are passed verbatim so the handler can perform
 * its own signature verification (no transformation at the controller layer).
 *
 * The command carries the full query map (not pre-extracted fields) because
 * VNPayService.verifyIpn() needs the original key set to re-derive the HMAC.
 * Extracting fields before verification would risk using unverified data.
 */
export class ProcessIpnCommand {
  constructor(
    /**
     * Raw VNPay query params from the IPN GET request.
     * Includes vnp_SecureHash. The handler strips it before signing.
     */
    public readonly query: Record<string, string>,
  ) {}
}
