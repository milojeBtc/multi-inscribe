import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import * as bip39 from 'bip39'
import BIP32Factory from 'bip32'
import { networks, initEccLib, Psbt, crypto, Transaction, payments, script, address } from 'bitcoinjs-lib'
import { InscriptionRequest, InscriptionTool } from '../../src/lib/ord'
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371'
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import fs from 'fs'
import { MockWallet, signBip322MessageSimple } from '../../mock-wallet'
import { testnet } from 'bitcoinjs-lib/src/networks'

//jest --testNamePattern="^ord-psbt inscribe first$" --runTestsByPath ./test/lib/ord-psbt.spec.ts

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)
const bip32 = BIP32Factory(ecc)

describe('ord-psbt', () => {
  it('inscribe first', async () => {
    const mnemonic = 'mimic tenant antenna choose legal humble come sustain legend hockey uncle nation'
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('invalid mnemonic')
    }
    const hdPath = "m/86'/0'/0'/0/3" // tb1p4h7nx9s5gukwc79hqmcvlyduyd7eey80rq5eec7l8ejvr6fl2dzqlhrxtz
    const network = networks.testnet // signet or test3 both use testnet in bitcoinjs-lib
    const ecPair = ECPair.fromPrivateKey(
      bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic), network).derivePath(hdPath).privateKey!,
      { network }
    )
    console.log('print address')
    console.log('commit address ' + payments.p2tr({ internalPubkey: toXOnly(ecPair.publicKey), network }).address)
    // easy to get utxo from
    console.log('creating a request')
    const imageData = fs.readFileSync('./1.png', 'base64')
    const request: InscriptionRequest = {
      commitUtxoList: [
        {
          hash: Buffer.from('e3281d734001a05158dae36ec880475921438123a97864bd6623ce7f4fcdd82c', 'hex'),
          index: 1,
        },
      ],
      commitUtxoECPairList: [ecPair],
      commitFeeRate: 4,
      feeRate: 5,
      dataList: [
        {
          // contentType: 'text/plain;charset=utf-8',
          contentType: 'image/png',
          // body: Buffer.from('{"p":"brc-20","op":"transfer","tick":"asig","amt":"10000000"}', 'utf-8'),
          body: Buffer.from(imageData, 'base64'),
          destination: 'tb1pgfu6rz0x4halm7qyeknxdg2hlnlg020cd6x8zpvny7utgldwevjq9hp5vd',
        },
      ],
      revealOutValue: 1000,
    }
    console.log('creating a new tool')
    const tool = await InscriptionTool.newTool('testnet', request)
    console.log('tool is created')
    const recoveryKeyWIFList = tool.getRecoveryKeyWIFList()
    tool.signTx()
    console.log("signed tx")
    const result = await tool.inscribe()
    console.log(JSON.stringify(result))

    // {"commitTxHash":"aa2fb1410f43e4be99de6a92e00d32abe80fbbc45a95638521c6cdf07f357519","revealTxHashList":["70febe7ea554983419fe312312fbcfb9eb8d2d1af10f3402e673920ca9d8c1fb"],"inscriptions":["70febe7ea554983419fe312312fbcfb9eb8d2d1af10f3402e673920ca9d8c1fbi0"]}
  }, 100000000)

  // jest --testNamePattern="^ord-psbt inscribe second$" --runTestsByPath ./test/lib/ord-psbt.spec.ts
  it('inscribe second', async () => {
    const mnemonic = 'mimic tenant antenna choose legal humble come sustain legend hockey uncle nation'
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

    const existsInscriptionUtxoPublicKey = '024e27b00310fa26d2603cb913dbdfe82cadee9d31f07ad3faf542c2a52bf9327d' // get from when connect to https://demo.unisat.io/

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

    const readlineInterface = createInterface({ input, output })
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

  // jest --testNamePattern="^ord-psbt wallet test$" --runTestsByPath ./test/lib/ord-psbt.spec.ts
  it('wallet test', async () => {
    const mockWallet = new MockWallet()
    console.log('address', mockWallet.address)
    console.log('public key', mockWallet.publicKey)
    const message = await signBip322MessageSimple({
      message: 'Hello Asigna!',
      address: mockWallet.address,
      network: testnet,
      wallet: mockWallet,
    })
    console.log(message)
  }, 100000000)
})
