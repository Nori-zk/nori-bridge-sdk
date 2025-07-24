# Mina zkApp: Token Bridge

A Mina zk-program contract allowing users to mint tokens on Nori Bridge.

## How to build

```sh
npm run build
```

## How to run tests

Install Mina lightnet

1. `npm install -g zkapp-cli`
2. `zk lightnet start`

```sh
npm run test # all tests (hangs due to multiple instances of o1js deps)
npm run test -- -t 'should_perform_attestation_pipeline' # run a specific test (e.g. the attestation pipeline)
npm run testw # watch mode
```

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
