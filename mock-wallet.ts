import * as bitcoin from 'bitcoinjs-lib';
import { initEccLib, networks} from 'bitcoinjs-lib'
import { encode } from 'varuint-bitcoin';
import * as ecc from 'tiny-secp256k1'
import * as bip39 from 'bip39'
import BIP32Factory, { BIP32Interface } from 'bip32'
import ECPairFactory, { ECPairInterface } from 'ecpair'
import { Buffer } from 'buffer';

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)
const bip32 = BIP32Factory(ecc)

function bip0322_hash(message: string) {
  const { sha256 } = bitcoin.crypto;
  const tag = 'BIP0322-signed-message';
  const tagHash = sha256(Buffer.from(tag));
  const result = sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message)]));
  return result.toString('hex');
}

export async function signBip322MessageSimple({
  message,
  address,
  network,
  wallet
}: {
  message: string;
  address: string;
  network: bitcoin.Network;
  wallet?: any;
}) {
  const outputScript = bitcoin.address.toOutputScript(address, network);

  const prevoutHash = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
  const prevoutIndex = 0xffffffff;
  const sequence = 0;
  const scriptSig = Buffer.concat([Buffer.from('0020', 'hex'), Buffer.from(bip0322_hash(message), 'hex')]);

  const txToSpend = new bitcoin.Transaction();
  txToSpend.version = 0;
  txToSpend.addInput(prevoutHash, prevoutIndex, sequence, scriptSig);
  txToSpend.addOutput(outputScript, 0);

  const psbtToSign = new bitcoin.Psbt();
  psbtToSign.setVersion(0);
  psbtToSign.addInput({
    hash: txToSpend.getHash(),
    index: 0,
    sequence: 0,
    witnessUtxo: {
      script: outputScript,
      value: 0
    }
  });
  psbtToSign.addOutput({ script: Buffer.from('6a', 'hex'), value: 0 });
  await wallet.signPsbt(psbtToSign);
  const txToSign = psbtToSign.extractTransaction();

  function encodeVarString(b: Buffer) {
    return Buffer.concat([encode(b.byteLength), b]);
  }

  const len = encode(txToSign.ins[0].witness.length);
  const result = Buffer.concat([len, ...txToSign.ins[0].witness.map((w) => encodeVarString(w))]);

  const signature = result.toString('base64');
  return signature;
}

export class MockWallet {
    private mnemonic = 'mimic tenant antenna choose legal humble come sustain legend hockey uncle nation'
    private hdPath = "m/86'/0'/0'/0/3"
    private network = networks.testnet
    private ecPair: ECPairInterface
    public address: string
    public publicKey: string
    private bip32: BIP32Interface

    constructor() {
        if (!bip39.validateMnemonic(this.mnemonic)) {
            throw new Error('invalid mnemonic')
        }
        this.bip32 = bip32.fromSeed(bip39.mnemonicToSeedSync(this.mnemonic), this.network) 
        this.ecPair = ECPair.fromPrivateKey(
          this.bip32.derivePath(this.hdPath).privateKey!,
          { network: this.network }
        )
        this.address = bitcoin.payments.p2tr({ internalPubkey: this.ecPair.publicKey.slice(1, 33), network: this.network }).address as string
        this.publicKey = this.ecPair.publicKey.toString("hex")
    }

    signPsbt(psbt: bitcoin.Psbt): bitcoin.Psbt {
      psbt.signInput(0, this.bip32)
      psbt.validateSignaturesOfInput(0, () => true)
      psbt.finalizeInput(0)
      return psbt
    }
}