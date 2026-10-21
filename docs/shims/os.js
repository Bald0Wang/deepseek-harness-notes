// node:os 的浏览器 shim。

export const EOL = '\n'
export const platform = () => 'browser'
export const homedir = () => '/home/dsh-visitor'
export const tmpdir = () => '/tmp'
export const hostname = () => 'browser'

export default { EOL, platform, homedir, tmpdir, hostname }
