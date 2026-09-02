import os
for root, dirs, files in os.walk('d:\\saintGobainSearch\\Frontend\\src'):
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            print(os.path.join(root, file))
