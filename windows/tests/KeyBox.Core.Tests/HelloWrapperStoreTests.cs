using KeyBox.Core.Vault;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>DPAPI 包裹物存储测试（Windows 专用；CI 为 windows-latest 可跑）。</summary>
public class HelloWrapperStoreTests : IDisposable
{
    private readonly string _dir;
    private readonly string _path;

    public HelloWrapperStoreTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "keybox-tests-" + Guid.NewGuid().ToString("N"));
        _path = Path.Combine(_dir, "hello.bin");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); }
        catch (IOException) { }
    }

    [Fact]
    public void Save_Then_Load_RoundTrips_MasterKey()
    {
        var store = new HelloWrapperStore(_path);
        byte[] raw = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();

        store.Save(raw);
        Assert.True(store.Exists);

        byte[]? loaded = store.Load();
        Assert.NotNull(loaded);
        Assert.Equal(raw, loaded);
    }

    [Fact]
    public void Load_Encrypted_Blob_Is_Not_Plaintext()
    {
        var store = new HelloWrapperStore(_path);
        byte[] raw = Enumerable.Repeat((byte)0x42, 32).ToArray();
        store.Save(raw);

        byte[] blob = File.ReadAllBytes(_path);
        Assert.NotEqual(raw, blob); // DPAPI 密文 ≠ 明文
    }

    [Fact]
    public void Load_Missing_Returns_Null()
    {
        var store = new HelloWrapperStore(_path);
        Assert.False(store.Exists);
        Assert.Null(store.Load());
    }

    [Fact]
    public void Load_Corrupt_Blob_Returns_Null()
    {
        var store = new HelloWrapperStore(_path);
        File.WriteAllBytes(_path, new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });
        Assert.Null(store.Load());
    }

    [Fact]
    public void Save_Rejects_Non_32_Byte_Key()
    {
        var store = new HelloWrapperStore(_path);
        Assert.Throws<ArgumentException>(() => store.Save(new byte[16]));
    }

    [Fact]
    public void Delete_Removes_Blob()
    {
        var store = new HelloWrapperStore(_path);
        store.Save(Enumerable.Repeat((byte)1, 32).ToArray());
        Assert.True(File.Exists(_path));

        store.Delete();
        Assert.False(File.Exists(_path));
        Assert.Null(store.Load());
    }
}
