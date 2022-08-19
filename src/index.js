const { ArgumentParser } = require('argparse');
const readlineSync = require('readline-sync');
const TronWeb = require('tronweb');
const hre = require("hardhat");

let tronWeb;
let gNetwork = {};

function asc2str(s) {
  let result = []
  for (var i =0; i < s.length; i += 2) {
    const c = parseInt(s.substr(i, 2), 16)
    result.push(String.fromCharCode(c))
  }
  return result.join("")
}

module.exports = {
  ZERO_ADDRESS_HEX: "410000000000000000000000000000000000000000",

  async setNetwork(name) {
    gNetwork.name = name
    if (['tron', 'shasta'].indexOf(name) > -1) {
      gNetwork.type = 'TRON'
      if (name == 'tron') {
        const api = 'https://api.trongrid.io'
        const privateKey = process.env.PRIVATE_KEY_TRON_MAIN
        gNetwork.web3 = await this.init(api, privateKey)
      } else if (name == 'shasta') {
        const api = 'https://api.shasta.trongrid.io'
        const privateKey = process.env.PRIVATE_KEY_TRON_SHASTA
        gNetwork.web3 = await this.init(api, privateKey)
      }
    } else {
      gNetwork.type = 'ETH'
      await hre.changeNetwork(name)
      gNetwork.web3 = hre.ethers
    }
  },
  web3() {
    return gNetwork.web3
  },
  getNetworkType() {
    return gNetwork.type
  },
  getNetworkName() {
    return gNetwork.name
  },
  formatAddress(addr) {
    return gNetwork.type == 'TRON'?
      gNetwork.web3.address.fromHex(addr):
      addr
  },
  async getOwner() {
    if (gNetwork.type == 'TRON') {
      return tronWeb.defaultAddress.base58;
    }
    const [owner] = await hre.ethers.getSigners();
    return owner.address;
  },
  async init(api, privateKey) {
    tronWeb = new TronWeb({
      fullHost: api,
      headers: {"TRON-PRO-API-KEY": process.env.TRON_API_KEY},
      privateKey: privateKey
    })
    return tronWeb;
  },

  async deploy(factoryName, contractName, parameters, opt = {}) {
    const displayName = opt.isProxy? factoryName: contractName
    const ok = readlineSync.question('Contract <' + displayName + '> will be deployed on *** ' + gNetwork.name.toUpperCase() + ' ***. Do you really want to continue?(y/N)');
    if (ok.toLowerCase() != 'y') return

    let issuerAddress = await this.getOwner();
    // console.log(issuerAddress)

    let Contract;
    if(opt.hasOwnProperty("libraries")) {
      Contract = await hre.ethers.getContractFactory(factoryName, {libraries:opt.libraries});
    } else {
      Contract = await hre.ethers.getContractFactory(factoryName);
    }

    let contract;
    if (gNetwork.type == 'TRON') {
      issuerAddress = tronWeb.address.toHex(issuerAddress);
      const bytecode = Contract.bytecode;
      let abi = (await hre.artifacts.readArtifact(factoryName)).abi
      if (opt.isProxy) {
        const abiImpl = (await hre.artifacts.readArtifact(contractName)).abi
        // for (v of abiImpl) {
        //   if (v.type !== 'constructor') {
        //     abi.push(v)
        //   }
        // }
        abi = abi.concat(abiImpl)
      }
      let options = {
        feeLimit: 1_500_000_000,
        abi: JSON.stringify(abi), //Abi string
        bytecode: bytecode,       //Bytecode, default hexString
        name: contractName,       //Contract name string
        owner_address: issuerAddress,
      };
      options.parameters = parameters;
      let data = await tronWeb.transactionBuilder.createSmartContract(options, issuerAddress);

      const signedTxn = await tronWeb.trx.sign(data);
      const receipt = await tronWeb.trx.sendRawTransaction(signedTxn);
      await this.waitForTransaction(receipt.transaction.txID);
      let contractAddress = receipt.transaction.contract_address;
      contract = await this.getContractAt(displayName, tronWeb.address.fromHex(contractAddress));
    } else {
      contract = await Contract.deploy(...parameters)
      await contract.deployed()
    }
    console.log(displayName + " deployed at: " + contract.address);
    return contract
  },

  async getContractAt(name, addr) {
    if (gNetwork.type == 'ETH') {
      return await hre.ethers.getContractAt(name, addr)
    } else if (gNetwork.type == 'TRON') {
      let {abi} = await hre.artifacts.readArtifact(name)
      contract = await tronWeb.contract(abi, addr);
      return new Proxy(contract, {
        get: (target, prop, receiver) => {
          // console.debug('prop: ', prop)
          if (['then', 'abi', 'address', 'methodInstances'].indexOf(prop) > -1) {
            return Reflect.get(target, prop)
          }
          return new Proxy(target[prop], {
            apply: function(target2, ctx, args) {
              // console.log(ctx.keys)
              const mutability = ctx.methodInstances[prop].abi.stateMutability
              if (mutability == 'view' || mutability == 'pure') {
                return Reflect.apply(...arguments).call()
              } else {
                return Reflect.apply(...arguments).send({
                  feeLimit: 1_000_000_000,
                  callValue: 0,
                  shouldPollResponse: false
                })
              }
            },
          })
        }
      })
    }
  },
  parseError(cause) {
    let msg = ''
    if (cause.substr(0,8) == '08c379a0') {
      // Error(string)
      msg = 'Error("' + asc2str(cause.substr(136, 64)) +'")'
    } else if (cause.substr(0, 8) == '4e487b71') {
      // Panic(uint256)
      msg = 'Panic(' + parseInt(cause.substr(8, 64), 16) + ')'
    }
    return msg
  },
  async waitForTransaction(tx, confirmed=false) {
    if (gNetwork.type == 'ETH') {
      const result = await tx.wait()
      console.log(result.transactionHash)
    } else {
      console.log(tx)
      do {
        await this.sleep(3)
        if (confirmed)
          result = await gNetwork.web3.trx.getTransactionInfo(tx)
        else
          result = await gNetwork.web3.trx.getUnconfirmedTransactionInfo(tx)
        // console.log(result)
        if (result.receipt) {
          if (result.receipt.result !== 'SUCCESS') {
            console.log('Transaction ' + result.receipt.result + '. Because of:')
            for (cause of result.contractResult) {
              console.log('\t%s %s.', cause, this.parseError(cause))
            }
          }
        }
      } while (typeof(result.receipt) == 'undefined')
    }
  },
  async sleep(time) {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve()
      }, time * 1000)
    })
  },
  addressToHex(address) {
    if (address.substr(0, 2) == '0x')
      return address
    return "0x" + tronWeb.address.toHex(address).substr(2, 42);
  },
  addressToHex2(address) {
    if (address.substr(0, 2) == '0x')
      return address
    return tronWeb.address.toHex(address);
  },
  ZERO_ADDRESS() {
    if (gNetwork.type == 'TRON')
      return "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
    return "0x0000000000000000000000000000000000000000"
  }, 
  async parseArgs() {
    const parser = new ArgumentParser({})
    parser.add_argument('-n', '--network', {help: 'network name(BSC/ROPSTEN/TRON/SHASTA/...)'})
    parser.add_argument('-f', '--function', {help: 'function name you want to call?'})
    args = parser.parse_args()
    await this.setNetwork(args.network)
    return args.function
  }
}