# GitHub Action for Tencent Cloud CDN certificate deployment

Deploy SSL certificate to Tencent Cloud CDN.

## Usage

This action will deploy your PEM-formatted SSL certificate to Tencent Cloud CDN.

```yaml
jobs:
  deploy-to-qcloud-cdn:
    name: Deploy certificate to Tencent Cloud CDN
    runs-on: ubuntu-latest
    steps:
      - name: Check out
        uses: actions/checkout@v2
        with:
          # If you just commited and pushed your newly issued certificate to this repo in a previous job,
          # use `ref` to make sure checking out the newest commit in this job
          ref: ${{ github.ref }}
      - uses: renbaoshuo/deploy-certificate-to-tencentcloud@v1
        with:
          # Use Access Key
          secret-id: ${{ secrets.QCLOUD_SECRET_ID }}
          secret-key: ${{ secrets.QCLOUD_SECRET_KEY }}

          # Specify PEM fullchain file
          fullchain-file: ${{ env.FILE_FULLCHAIN }}
          # Specify PEM private key file
          key-file: ${{ env.FILE_KEY }}

          # Deploy to CDN
          cdn-domains: |
            cdn1.example.com
            cdn2.example.com
```
