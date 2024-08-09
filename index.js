const core = require('@actions/core');

const fs = require('fs');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const tencentcloudSsl = require('tencentcloud-sdk-nodejs-ssl');

const input = {
  secretId: core.getInput('secret-id'),
  secretKey: core.getInput('secret-key'),
  fullchainFile: core.getInput('fullchain-file'),
  keyFile: core.getInput('key-file'),
  cdnDomains: core.getInput('cdn-domains'),
};

const sharedClientConfig = {
  credential: {
    secretId: input.secretId,
    secretKey: input.secretKey,
  },
  region: '',
};

const cdnClientConfig = {
  ...sharedClientConfig,
  profile: {
    httpProfile: {
      endpoint: 'cdn.tencentcloudapi.com',
    },
  },
};

const sslClientConfig = {
  ...sharedClientConfig,
  profile: {
    httpProfile: {
      endpoint: 'ssl.tencentcloudapi.com',
    },
  },
};

async function queryCdnDomainCerts(domains) {
  const client = new tencentcloud.cdn.v20180606.Client(cdnClientConfig);
  const params = {
    Offset: 0,
    Limit: 1000,
    Filters: [
      {
        Name: 'domain',
        Value: domains,
      },
    ],
  };

  return await client.DescribeDomainsConfig(params).then(
    (data) => {
      console.log('Success:', 'DescribeDomainsConfig');

      return data.Domains.map((domain) => ({
        domain: domain.Domain,
        certId: domain.Https?.CertInfo?.CertId,
      }));
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );
}

async function uploadCert(cert, key) {
  const client = new tencentcloudSsl.ssl.v20191205.Client(sslClientConfig);

  const params = {
    CertificatePublicKey: cert,
    CertificatePrivateKey: key,
    Repeatable: true,
  };

  return await client.UploadCertificate(params).then(
    (data) => {
      console.log('Success:', data);

      return data.CertificateId;
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );
}

async function updateCert(oldCertId, newCertId) {
  const client = new tencentcloudSsl.ssl.v20191205.Client(sslClientConfig);

  const params = {
    OldCertificateId: oldCertId,
    ResourceTypes: ['cdn'],
    CertificateId: newCertId,
    ExpiringNotificationSwitch: 1,
  };

  await client.UpdateCertificateInstance(params).then(
    (data) => {
      console.log('Success:', data);
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );
}

async function updateCdnDomainConfig(domain, certId) {
  const client = new tencentcloud.cdn.v20180606.Client(cdnClientConfig);
  const params = {
    Domain: domain,
    Https: {
      Switch: 'on',
      Http2: 'on',
      CertInfo: {
        CertId: certId,
      },
    },
  };

  await client.UpdateDomainConfig(params).then(
    (data) => {
      console.log('Success:', data);
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );
}

async function main() {
  const domains = Array.from(new Set(input.cdnDomains.split(/\s+/).filter((x) => x)));

  const cert = fs.readFileSync(input.fullchainFile, 'utf8');
  const key = fs.readFileSync(input.keyFile, 'utf8');

  const certId = await uploadCert(cert, key, input.certId);
  console.log('CertId:', certId);

  const oldCerts = await queryCdnDomainCerts(domains);
  const oldCertIds = [...new Set(oldCerts.map((x) => x.certId).filter(Boolean))];
  const domainWithoutCert = oldCerts
    .filter((x) => !x.certId)
    .map((x) => x.domain)
    .filter(Boolean);

  console.log('oldCertIds:', oldCertIds);

  if (oldCertIds.length > 0) {
    for (const oldCertId of oldCertIds) {
      await updateCert(oldCertId, certId);

      console.log('Successfully updated cert', oldCertId, 'to', certId);
    }
  }

  console.log('Domains without cert:', domainWithoutCert);

  if (domainWithoutCert.length > 0) {
    for (const domain of domainWithoutCert) {
      await updateCdnDomainConfig(domain, certId);

      console.log('Successfully updated domain', domain, 'with cert', certId);
    }
  }
}

main().catch((error) => {
  console.log(error.stack);
  core.setFailed(error);
  process.exit(1);
});
