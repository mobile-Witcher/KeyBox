using KeyBox.Core.Data;
using Xunit;

namespace KeyBox.Core.Tests;

public class KbRecoveryTests
{
    [Fact]
    public void NormalizeRecoveryCode_Strips_Separators_And_Uppercases()
    {
        // 只保留 base32 字符（A-Z2-7），去掉连字符/空格/其它
        Assert.Equal("ABCDEFGHIJKLMNOPQRSTUVWX2Y3Z", KbRecovery.NormalizeRecoveryCode("abcd-efgh ijkl-mnop qrst-uvwx 2y3z"));
        Assert.Equal("", KbRecovery.NormalizeRecoveryCode("0189-----"));
    }

    [Fact]
    public void FormatRecoveryCode_Groups_By_4()
    {
        Assert.Equal("ABCD-EFGH-IJKL", KbRecovery.FormatRecoveryCode("ABCDEFGHIJKL"));
    }

    [Fact]
    public void Wrap_Then_Unwrap_RoundTrips_Same_MasterKey_And_Prefix()
    {
        byte[] masterKey = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();
        string recoverySalt = "cmVjb3ZlcnlzYWx0MTIzNDU2Nzg="; // 16B salt (不同串即可)
        string kdfSalt = "a2Rmc2FsdDEyMzQ1Njc4OTAxMjM0"; // 不同串

        string blob = KbRecovery.WrapMasterKeyWithRecovery("ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2Y3Z-4567", recoverySalt, kdfSalt, masterKey);
        Assert.StartsWith("KBRC1:", blob);

        byte[] recovered = KbRecovery.UnwrapMasterKeyWithRecovery(
            "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2Y3Z-4567", recoverySalt, blob);
        Assert.Equal(masterKey, recovered);
    }

    [Fact]
    public void Wrap_Rejects_RecoverySalt_Equal_KdfSalt()
    {
        string same = "c2FtZXNhbHRzYW1lc2FsdA==";
        Assert.Throws<ArgumentException>(() =>
            KbRecovery.WrapMasterKeyWithRecovery("ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2Y3Z-4567", same, same, new byte[32]));
    }

    [Fact]
    public void Unwrap_Wrong_Code_Throws()
    {
        byte[] masterKey = new byte[32];
        string recoverySalt = "cmVjb3ZlcnlzYWx0MTIzNDU2Nzg=";
        string blob = KbRecovery.WrapMasterKeyWithRecovery("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", recoverySalt, "kdfSaltDifferent==", masterKey);

        Assert.ThrowsAny<Exception>(() =>
            KbRecovery.UnwrapMasterKeyWithRecovery("BBBB-BBBB-BBBB-BBBB-BBBB-BBBB-BBBB-BBBB", recoverySalt, blob));
    }

    [Fact]
    public void Unwrap_Wrong_Prefix_Throws()
    {
        Assert.Throws<FormatException>(() =>
            KbRecovery.UnwrapMasterKeyWithRecovery("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", "salt==", "KB1:AAAA"));
    }
}
