export const buf2hex = (buffer: ArrayBuffer) => { // buffer is an ArrayBuffer
  return [...new Uint8Array(buffer)]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
}

export const hash = async(data: string) => {
  const bin =  await crypto.subtle
    .digest('sha-256', new TextEncoder().encode(data))
  return buf2hex(bin)
}
