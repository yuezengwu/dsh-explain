// DSH 0.1.7 reads create(); earlier supported hosts read schema directly.
// Expose both views of the same generated validator, keeping new hosts lazy.
export function addLegacyCodecAccess(invocations) {
  for (const invocation of invocations) {
    const codecs = [
      invocation.result,
      ...invocation.parameters.map(parameter => parameter.codec),
      invocation.receiver?.codec,
      invocation.uplink?.codec,
    ]
    for (const codec of codecs) {
      if (codec?.mode !== 'strict') continue
      if (typeof codec.create === 'function') {
        if (!('schema' in codec)) {
          Object.defineProperty(codec, 'schema', {
            enumerable: true,
            get: () => codec.create(),
          })
        }
      } else if (typeof codec.schema?.parse === 'function') {
        codec.create = () => codec.schema
      } else {
        throw new Error(`dsh-explain: unsupported TypeRT codec ${codec.typeSymbol}`)
      }
    }
  }
}
