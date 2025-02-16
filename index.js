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
      console.debug(data);

      const res = data.Domains.map((domain) => ({
        domain: domain.Domain,
        certId: domain.Https?.CertInfo?.CertId,
      }));

      console.log(res);

      return res;
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );
}

async function uploadCert(cert, key) {
  const client = new tencentcloud.ssl.v20191205.Client(sslClientConfig);

  const params = {
    CertificatePublicKey: cert,
    CertificatePrivateKey: key,
    Repeatable: true,
  };

  return await client.UploadCertificate(params).then(
    (data) => {
      console.log('Success:', 'UploadCertificate', data.CertificateId);
      console.debug(data);

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
  const client = new tencentcloud.ssl.v20191205.Client(sslClientConfig);

  const params = {
    OldCertificateId: oldCertId,
    ResourceTypes: ['cdn'],
    CertificateId: newCertId,
    ExpiringNotificationSwitch: 1,
  };

  await client.UpdateCertificateInstance(params).then(
    (data) => {
      console.log('Success:', 'UpdateCertificateInstance', oldCertId, newCertId);
      console.debug(data);
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );

  for (let i = 1; i <= 60; i++) {
    console.log('Waiting for update task to complete...', `(${i}/60)`);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const isDone = await client.UpdateCertificateInstance(params).then(
      (data) => {
        console.debug(data);

        return (data.UpdateSyncProgress || []).every((task) => task.Status === 1);
      },
      (err) => {
        if (err.Code === 'FailedOperation.CertificateDeployInstanceEmpty') {
          console.log(
            'Update task skipped because "FailedOperation.CertificateDeployInstanceEmpty".'
          );

          return true;
        }

        console.error(err);
        core.setFailed(err);
        process.exit(1);
      }
    );

    if (isDone) {
      console.log('Update task completed');

      return;
    }
  }

  console.error('Update task timeout');
}

const DELETE_STATUS_MAP = {
  0: 'In progress',
  1: 'Completed',
  2: 'Failed',
  3: 'Unauthorized, need `SSL_QCSLinkedRoleInReplaceLoadCertificate` role',
  4: 'Failed because of cert is using by other resources',
  5: 'Internal timeout',
};

async function deleteCertificates(certIds) {
  const client = new tencentcloud.ssl.v20191205.Client(sslClientConfig);
  const params = {
    CertificateIds: certIds,
    IsSync: true,
  };

  const taskIds = await client.DeleteCertificates(params).then(
    (data) => {
      console.log('Success:', 'DeleteCertificates');
      console.debug(data);

      const certTaskIds = data.CertTaskIds;

      console.log(certTaskIds);

      return certTaskIds.map((x) => x.TaskId);
    },
    (err) => {
      console.error(err);
      core.setFailed(err);
      process.exit(1);
    }
  );

  for (let i = 1; i <= 60; i++) {
    console.log('Waiting for delete task to complete...', `(${i}/60)`);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const isDone = await client.DescribeDeleteCertificatesTaskResult({ TaskIds: taskIds }).then(
      (data) => {
        console.log('Success:', 'DescribeDeleteCertificatesTaskResult');
        console.debug(data);

        const tasks = data.DeleteTaskResult;

        console.log(
          tasks
            .map((task) =>
              [
                task.TaskId,
                task.CertId,
                DELETE_STATUS_MAP[task.Status] || task.Status,
                task.Error || '',
                (task.Domains || []).join(','),
              ].join('\t')
            )
            .join('\n')
        );

        return tasks.every((x) => x.Status !== 0);
      },
      (err) => {
        console.error(err);
        core.setFailed(err);
        process.exit(1);
      }
    );

    if (isDone) {
      console.log('Delete task completed');

      return;
    }
  }

  console.error('Delete task timeout');
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
      console.debug(data);
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

  // Delete old certs
  if (oldCertIds.length > 0) {
    await deleteCertificates(oldCertIds);
  }
}

main().catch((error) => {
  console.log(error.stack);
  core.setFailed(error);
  process.exit(1);
});
