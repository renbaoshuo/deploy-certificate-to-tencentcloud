const core = require('@actions/core');

const fs = require('fs');
const tencentcloud = require('tencentcloud-sdk-nodejs');

const input = {
  secretId: core.getInput('secret-id'),
  secretKey: core.getInput('secret-key'),
  fullchainFile: core.getInput('fullchain-file'),
  keyFile: core.getInput('key-file'),
  cdnDomains: core.getInput('cdn-domains'),
};

const clientConfig = {
  credential: {
    secretId: input.secretId,
    secretKey: input.secretKey,
  },
  region: '',
  profile: {
    httpProfile: {
      endpoint: 'cdn.tencentcloudapi.com',
    },
  },
};

async function main() {
  const domains = Array.from(new Set(input.cdnDomains.split(/\s+/).filter((x) => x)));

  const cert = fs.readFileSync(input.fullchainFile, 'utf8');
  const key = fs.readFileSync(input.keyFile, 'utf8');

  for (const domain of domains) {
    console.log('Deploying:', domain);

    const client = new tencentcloud.cdn.v20180606.Client(clientConfig);
    const params = {
      Domain: domain,
      Https: {
        Switch: 'on',
        CertInfo: {
          Certificate: cert,
          PrivateKey: key,
        },
      },
    };

    await client.UpdateDomainConfig(params).then(
      (data) => {
        console.log('Success:', data);
      },
      (err) => {
        console.error(err);
        core.setFailed(error);
        process.exit(1);
      }
    );
  }
}

main().catch((error) => {
  console.log(error.stack);
  core.setFailed(error);
  process.exit(1);
});
