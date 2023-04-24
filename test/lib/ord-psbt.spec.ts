import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import * as bip39 from 'bip39'
import BIP32Factory from 'bip32'
import { networks, initEccLib, Psbt, crypto, Transaction, payments, script, address } from 'bitcoinjs-lib'
import { InscriptionRequest, InscriptionTool } from '../../src/lib/ord'
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371'
import * as readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)
const bip32 = BIP32Factory(ecc)

describe('ord-psbt', () => {
  it('inscribe first', async () => {
    const mnemonic = 'your mnemonic'
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('invalid mnemonic')
    }
    const hdPath = "m/86'/0'/0'/0/2" // tb1p4h7nx9s5gukwc79hqmcvlyduyd7eey80rq5eec7l8ejvr6fl2dzqlhrxtz
    const network = networks.testnet // signet or test3 both use testnet in bitcoinjs-lib
    const ecPair = ECPair.fromPrivateKey(
      bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic), network).derivePath(hdPath).privateKey!,
      { network }
    )
    console.log('commit utxo address ' + payments.p2tr({ internalPubkey: toXOnly(ecPair.publicKey), network }).address)
    // easy to get utxo from https://mempool.space/signet/api/address/tb1p4h7nx9s5gukwc79hqmcvlyduyd7eey80rq5eec7l8ejvr6fl2dzqlhrxtz/utxo
    const request: InscriptionRequest = {
      commitUtxoList: [
        {
          hash: Buffer.from('d476456e381371b47074ef8f37d5063848a04004fddd11b2b157cb18c10fbca3', 'hex'),
          index: 0,
        },
      ],
      commitUtxoECPairList: [ecPair],
      commitFeeRate: 4,
      feeRate: 5,
      dataList: [
        {
          contentType: 'text/plain;charset=utf-8',
          body: Buffer.from('TestTest1', 'utf-8'),
          destination: 'tb1p4h7nx9s5gukwc79hqmcvlyduyd7eey80rq5eec7l8ejvr6fl2dzqlhrxtz',
        },
      ],
      revealOutValue: 1000,
    }
    const tool = await InscriptionTool.newTool('signet', request)
    const recoveryKeyWIFList = tool.getRecoveryKeyWIFList()
    recoveryKeyWIFList.forEach((wif) => console.log(`wif: ${wif}`))
    tool.signTx()
    console.log(`commitTx: ${tool.getCommitTxHex()}`)
    tool.getRevealTxHexList().forEach((revealTxHex) => console.log(`revealTx: ${revealTxHex}`))
    const result = await tool.inscribe()
    console.log(JSON.stringify(result))

    // {"commitTxHash":"aa2fb1410f43e4be99de6a92e00d32abe80fbbc45a95638521c6cdf07f357519","revealTxHashList":["70febe7ea554983419fe312312fbcfb9eb8d2d1af10f3402e673920ca9d8c1fb"],"inscriptions":["70febe7ea554983419fe312312fbcfb9eb8d2d1af10f3402e673920ca9d8c1fbi0"]}
  }, 100000000)

  // jest --testNamePattern="^ord-psbt inscribe second$" --runTestsByPath ./test/lib/ord-psbt.spec.ts
  it('inscribe second', async () => {
    const mnemonic = 'your mnemonic'
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('invalid mnemonic')
    }
    const hdPath = "m/86'/0'/0'/0/3" // tb1plh7r46gc73ph6aq33jgwds724dv77atu4um840hgcnwcq2mmc6kqxg298f
    const network = networks.testnet // signet or test3 both use testnet in bitcoinjs-lib
    const commitUtxoEcPair = ECPair.fromPrivateKey(
      bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic), network).derivePath(hdPath).privateKey!,
      { network }
    )
    console.log(
      'commit utxo address ' + payments.p2tr({ internalPubkey: toXOnly(commitUtxoEcPair.publicKey), network }).address
    )

    const existsInscriptionUtxoPublicKey = '038d2f234c6fc49a9744e4d326306dabf408a4e3aa639a25ca2bcf0b02dc3cddfa' // get from when connect to https://demo.unisat.io/

    const inscribeCtx = {
      contentType: 'text/plain;charset=utf-8',
      body: Buffer.from('Inscribe Test Test', 'utf-8'),
      destination: 'tb1p4h7nx9s5gukwc79hqmcvlyduyd7eey80rq5eec7l8ejvr6fl2dzqlhrxtz',
    }
    const request: InscriptionRequest = {
      existsInscriptionUtxoList: [
        {
          hash: Buffer.from('b049d96f998c410d808a782b71e3e2ac74bb2af71d20e63a4e71518dcaedd15f', 'hex'), // is first reveal tx hash
          index: 0, // ...
        },
      ],
      existsInscriptionUtxoECPairList: [
        ECPair.fromPublicKey(Buffer.from(existsInscriptionUtxoPublicKey, 'hex'), { network }),
      ],
      // easy to get utxo from https://mempool.space/signet/api/address/tb1plh7r46gc73ph6aq33jgwds724dv77atu4um840hgcnwcq2mmc6kqxg298f/utxo
      commitUtxoList: [
        {
          hash: Buffer.from('b049d96f998c410d808a782b71e3e2ac74bb2af71d20e63a4e71518dcaedd15f', 'hex'),
          index: 1,
        },
      ],
      commitUtxoECPairList: [commitUtxoEcPair],
      commitFeeRate: 4,
      feeRate: 5,
      dataList: [inscribeCtx],
      revealOutValue: 999,
    }
    const tool = await InscriptionTool.newTool('signet', request)

    const readlineInterface = readline.createInterface({ input, output })
    const signResult = await readlineInterface.question(
      `
      1. go to https://demo.unisat.io/. source https://github.com/unisat-wallet/unisat-web3-demo
      2. connect to unisat wallet, with  address ${
        payments.p2tr({ internalPubkey: toXOnly(Buffer.from(existsInscriptionUtxoPublicKey, 'hex')), network }).address
      }
        public key ${existsInscriptionUtxoPublicKey}
      3. scroll to Sign Psbt part.
      4. Paste psbt below to "PsbtHex" input box

      ${tool.getCommitPsbt().toString('hex')}

      5. click "Sign Psbt" button
      6. Sign On unisat wallet
      7. copy Sign Result.
      8. Paste here, and press enter


`
    )

    console.log(`signResult:
        ${signResult}
       `)
    readlineInterface.close()
    tool.setCommitPsbtAfterSignExistsInscriptionUtxoInput(Buffer.from(signResult.trim(), 'hex'))
    tool.signTx()
    const recoveryKeyWIFList = tool.getRecoveryKeyWIFList()
    recoveryKeyWIFList.forEach((wif) => console.log(`wif: ${wif}`))
    console.log(`commitTx: ${tool.getCommitTxHex()}`)
    tool.getRevealTxHexList().forEach((revealTxHex) => console.log(`revealTx: ${revealTxHex}`))
    const result = await tool.inscribe()
    console.log(JSON.stringify(result))

    //  inscribe second    {"commitTxHash":"7b2242e01cdf1ae0c71023b9bc9dec4a40645bf6f87168f1cdefcd111a113c51","revealTxHashList":["d97c160d7de348fedebc784c20cc8cc46e38e80cd40bf4d1da2f3e29cf21e365"],"inscriptions":["d97c160d7de348fedebc784c20cc8cc46e38e80cd40bf4d1da2f3e29cf21e365i0"]}
    //  inscribe third   {"commitTxHash":"7bea1f1db0af89e6e746d6ff17fa7f2e6747cda7c9ca65b96c898cc2b09406af","revealTxHashList":["b049d96f998c410d808a782b71e3e2ac74bb2af71d20e63a4e71518dcaedd15f"],"inscriptions":["b049d96f998c410d808a782b71e3e2ac74bb2af71d20e63a4e71518dcaedd15f0"]}
    //  inscribe fourth  {"commitTxHash":"273ca32afc59997d8afb351806d45354f8555d26f7b4dbd8ac43afe4dc8957a6","revealTxHashList":["fc7e8962d7c4141aacac5d521f9bef9d9deaac16f604a9281aba99245bc830e1"],"inscriptions":["fc7e8962d7c4141aacac5d521f9bef9d9deaac16f604a9281aba99245bc830e1i0"]}
  }, 100000000)
})
